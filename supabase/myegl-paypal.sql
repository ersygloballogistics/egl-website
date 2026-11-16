-- PayPal ledger. Provider credentials belong in Edge Function secrets, never in SQL.
create table public.myegl_paypal_orders (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.myegl_invoices(id),
 job_id uuid not null references public.portal_jobs(id),
 customer_id uuid not null references auth.users(id),
 mode text not null check (mode in ('live','sandbox')),
 status text not null default 'creating' check(status in ('creating','created','capturing','pending','completed','failed','expired','review_required')),
 paypal_order_id text, capture_id text,
 create_request_id uuid not null default gen_random_uuid(),
 capture_request_id uuid not null default gen_random_uuid(),
 invoice_total numeric(16,2) not null, paid_before numeric(16,2) not null,
 invoice_amount numeric(16,2) not null check(invoice_amount>0),
 invoice_currency text not null,
 paypal_amount numeric(16,2) not null check(paypal_amount>0),
 paypal_currency text not null,
 aed_per_usd numeric(12,6),
 provider_status text, failure_code text,
 applied_at timestamptz, refunded_amount numeric(16,2) not null default 0,
 refunded_invoice_amount numeric(16,2) not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(mode,paypal_order_id), unique(mode,capture_id)
);
create unique index myegl_paypal_one_active_invoice on public.myegl_paypal_orders(invoice_id,mode)
 where status in ('creating','created','capturing','pending','review_required');
create index myegl_paypal_job on public.myegl_paypal_orders(job_id);
create index myegl_paypal_customer on public.myegl_paypal_orders(customer_id);
alter table public.myegl_paypal_orders enable row level security;
revoke all on public.myegl_paypal_orders from public, anon, authenticated;
grant select on public.myegl_paypal_orders to authenticated;
grant select,insert,update on public.myegl_paypal_orders to service_role;
create policy "Customers read their PayPal receipts" on public.myegl_paypal_orders for select to authenticated
 using(customer_id=(select auth.uid()) and exists(select 1 from public.portal_customers c where c.id=(select auth.uid()) and c.approved));
create policy "Administrators read PayPal receipts" on public.myegl_paypal_orders for select to authenticated
 using(((select auth.jwt())->'app_metadata'->>'myegl_role')='admin');

create table private.myegl_paypal_refunds (
 refund_id text primary key, attempt_id uuid not null references public.myegl_paypal_orders(id),
 paypal_amount numeric(16,2) not null, invoice_amount numeric(16,2) not null,
 created_at timestamptz not null default now()
);
alter table private.myegl_paypal_refunds enable row level security;
revoke all on private.myegl_paypal_refunds from public,anon,authenticated;

-- These RPCs can only be called by the backend service role. The Edge Function
-- verifies the user JWT before supplying p_customer_id; customers cannot call them.
create function public.myegl_paypal_invoice(p_invoice_id uuid,p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.myegl_invoices%rowtype; j public.portal_jobs%rowtype;
begin
 select * into i from public.myegl_invoices where id=p_invoice_id;
 if not found or i.customer_id is distinct from p_customer_id then raise exception 'Invoice unavailable'; end if;
 if not exists(select 1 from public.portal_customers c join auth.users u on u.id=c.id
  where c.id=p_customer_id and c.approved and u.email_confirmed_at is not null and u.deleted_at is null
   and lower(trim(u.email))=lower(trim(i.customer_email))) then raise exception 'Approved account required'; end if;
 select * into j from public.portal_jobs where id=i.job_id;
 if j.customer_id is distinct from p_customer_id or j.quote_status<>'approved' or j.archived_at is not null
  or i.status not in ('issued','partially_paid') or i.total<>j.quoted_total or i.currency<>j.currency
  or i.total<=i.amount_paid or j.payment_status in ('paid','refunded') then raise exception 'Invoice is not payable'; end if;
 return to_jsonb(i)||jsonb_build_object('reference',j.reference,'remaining',i.total-i.amount_paid);
end $$;

create function public.myegl_paypal_reserve(p_invoice_id uuid,p_customer_id uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i jsonb; a public.myegl_paypal_orders%rowtype; v_job uuid; amount numeric; code text; pay_amount numeric; pay_code text;
begin
 if p_mode<>'live' then raise exception 'Live invoices cannot be used for sandbox tests'; end if;
 select job_id into v_job from public.myegl_invoices where id=p_invoice_id;
 perform 1 from public.portal_jobs where id=v_job for update;
 perform 1 from public.myegl_invoices where id=p_invoice_id for update;
 i:=public.myegl_paypal_invoice(p_invoice_id,p_customer_id);
 select * into a from public.myegl_paypal_orders where invoice_id=p_invoice_id and mode=p_mode
  and status in ('creating','created','capturing','pending','review_required') for update;
 if found then
  if a.status in ('creating','created') and (a.created_at<now()-interval '2 hours' or a.invoice_total<>(i->>'total')::numeric or a.paid_before<>(i->>'amount_paid')::numeric or a.invoice_currency<>i->>'currency') then
   update public.myegl_paypal_orders set status='expired',updated_at=now() where id=a.id;
  else return to_jsonb(a); end if;
 end if;
 amount:=(i->>'remaining')::numeric; code:=i->>'currency';
 if code='AED' then pay_code:='USD';pay_amount:=round(amount/3.6725,2);
 elsif code in ('USD','EUR','GBP') then pay_code:=code;pay_amount:=amount;
 else raise exception 'Please request a PayPal invoice in USD, EUR or GBP'; end if;
 if pay_amount<0.01 then raise exception 'Invoice amount is below the PayPal minimum'; end if;
 insert into public.myegl_paypal_orders(invoice_id,job_id,customer_id,mode,invoice_total,paid_before,invoice_amount,invoice_currency,paypal_amount,paypal_currency,aed_per_usd)
 values(p_invoice_id,v_job,p_customer_id,p_mode,(i->>'total')::numeric,(i->>'amount_paid')::numeric,amount,code,pay_amount,pay_code,case when code='AED' then 3.6725 end)
 returning * into a;
 return to_jsonb(a);
end $$;

create function public.myegl_paypal_prepare_capture(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.myegl_paypal_orders%rowtype; i jsonb;
begin
 select * into a from public.myegl_paypal_orders where id=p_attempt_id;
 if not found then raise exception 'Payment unavailable'; end if;
 perform 1 from public.portal_jobs where id=a.job_id for update;
 perform 1 from public.myegl_invoices where id=a.invoice_id for update;
 select * into a from public.myegl_paypal_orders where id=p_attempt_id for update;
 if a.applied_at is not null then return to_jsonb(a); end if;
 if a.status not in ('created','capturing','pending') or a.paypal_order_id is null then raise exception 'Payment is not ready'; end if;
 i:=public.myegl_paypal_invoice(a.invoice_id,a.customer_id);
 if (i->>'total')::numeric<>a.invoice_total or (i->>'amount_paid')::numeric<>a.paid_before or i->>'currency'<>a.invoice_currency then raise exception 'Invoice changed; contact ERSY GLOBAL'; end if;
 update public.myegl_paypal_orders set status=case when status='pending' then 'pending' else 'capturing' end,updated_at=now() where id=a.id returning * into a;
 return to_jsonb(a);
end $$;

create function public.myegl_paypal_finish(p_attempt_id uuid,p_order_id text,p_capture_id text,p_amount numeric,p_currency text,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.myegl_paypal_orders%rowtype; i public.myegl_invoices%rowtype;
begin
 select * into a from public.myegl_paypal_orders where id=p_attempt_id;
 if not found then raise exception 'Payment unavailable'; end if;
 perform 1 from public.portal_jobs where id=a.job_id for update;
 select * into i from public.myegl_invoices where id=a.invoice_id for update;
 select * into a from public.myegl_paypal_orders where id=p_attempt_id for update;
 if a.paypal_order_id is distinct from p_order_id or a.paypal_amount<>p_amount or a.paypal_currency<>p_currency
  or coalesce(p_capture_id,'')='' or p_status not in ('COMPLETED','PENDING','DECLINED','FAILED') then raise exception 'Payment verification mismatch'; end if;
 if a.capture_id is not null and a.capture_id<>p_capture_id then raise exception 'Capture mismatch'; end if;
 if a.applied_at is not null then return to_jsonb(a); end if;
 if a.mode<>'live' then raise exception 'Sandbox payments cannot change invoices'; end if;
 if p_status='COMPLETED' then
  if i.total<>a.invoice_total or i.amount_paid<>a.paid_before or i.currency<>a.invoice_currency or i.status not in ('issued','partially_paid') then
   update public.myegl_paypal_orders set status='review_required',capture_id=p_capture_id,provider_status=p_status,failure_code='INVOICE_CHANGED',updated_at=now() where id=a.id returning * into a;
  else
   -- Close the capture lock before applying the payment in this same transaction.
   update public.myegl_paypal_orders set status='completed',capture_id=p_capture_id,provider_status=p_status,applied_at=now(),updated_at=now() where id=a.id returning * into a;
   update public.myegl_invoices set amount_paid=total,status='paid',updated_at=now() where id=i.id;
   update public.portal_jobs set payment_status='paid',updated_at=now() where id=a.job_id;
  end if;
 else
  update public.myegl_paypal_orders set status=case when p_status='PENDING' then 'pending' else 'failed' end,
   capture_id=p_capture_id,provider_status=p_status,updated_at=now() where id=a.id returning * into a;
 end if;
 return to_jsonb(a);
end $$;

create function public.myegl_paypal_refund(p_attempt_id uuid,p_refund_id text,p_amount numeric,p_currency text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.myegl_paypal_orders%rowtype; i public.myegl_invoices%rowtype; delta numeric; cumulative numeric;
begin
 select * into a from public.myegl_paypal_orders where id=p_attempt_id;
 if not found then raise exception 'Payment unavailable'; end if;
 perform 1 from public.portal_jobs where id=a.job_id for update;
 select * into i from public.myegl_invoices where id=a.invoice_id for update;
 select * into a from public.myegl_paypal_orders where id=p_attempt_id for update;
 if exists(select 1 from private.myegl_paypal_refunds where refund_id=p_refund_id) then return to_jsonb(a); end if;
 if a.applied_at is null or a.paypal_currency<>p_currency or p_amount<=0 or a.refunded_amount+p_amount>a.paypal_amount then raise exception 'Refund requires reconciliation'; end if;
 cumulative:=round(a.invoice_amount*(a.refunded_amount+p_amount)/a.paypal_amount,2);
 delta:=cumulative-a.refunded_invoice_amount;
 if delta>i.amount_paid then raise exception 'Refund exceeds recorded balance'; end if;
 update public.myegl_paypal_orders set status='review_required',failure_code='REFUNDED',refunded_amount=refunded_amount+p_amount,refunded_invoice_amount=cumulative,updated_at=now() where id=a.id returning * into a;
 insert into private.myegl_paypal_refunds(refund_id,attempt_id,paypal_amount,invoice_amount) values(p_refund_id,a.id,p_amount,delta);
 update public.myegl_invoices set amount_paid=amount_paid-delta,status=case when amount_paid-delta=0 then 'issued' else 'partially_paid' end,updated_at=now() where id=i.id;
 update public.portal_jobs set payment_status=case when i.amount_paid-delta=0 then 'refunded' else 'pending' end,updated_at=now() where id=a.job_id;
 return to_jsonb(a);
end $$;

-- Prevent an admin edit racing a capture or a pending PayPal settlement.
create function private.myegl_paypal_lock_invoice() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.total,new.amount_paid,new.status,new.currency,new.customer_id) is distinct from (old.total,old.amount_paid,old.status,old.currency,old.customer_id)
  and exists(select 1 from public.myegl_paypal_orders where invoice_id=old.id and status in ('capturing','pending'))
 then raise exception 'PayPal payment is processing; reconcile it before changing this invoice'; end if;
 return new;
end $$;
create trigger myegl_paypal_invoice_lock before update on public.myegl_invoices for each row execute function private.myegl_paypal_lock_invoice();
create function private.myegl_paypal_lock_job() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.quote_status,new.quoted_total,new.currency,new.payment_status,new.customer_id) is distinct from (old.quote_status,old.quoted_total,old.currency,old.payment_status,old.customer_id)
  and exists(select 1 from public.myegl_paypal_orders where job_id=old.id and status in ('capturing','pending'))
 then raise exception 'PayPal payment is processing; reconcile it before changing this order'; end if;
 return new;
end $$;
create trigger myegl_paypal_job_lock before update on public.portal_jobs for each row execute function private.myegl_paypal_lock_job();

revoke all on function public.myegl_paypal_invoice(uuid,uuid),public.myegl_paypal_reserve(uuid,uuid,text),public.myegl_paypal_prepare_capture(uuid),public.myegl_paypal_finish(uuid,text,text,numeric,text,text),public.myegl_paypal_refund(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.myegl_paypal_invoice(uuid,uuid),public.myegl_paypal_reserve(uuid,uuid,text),public.myegl_paypal_prepare_capture(uuid),public.myegl_paypal_finish(uuid,text,text,numeric,text,text),public.myegl_paypal_refund(uuid,text,numeric,text) to service_role;
revoke all on function private.myegl_paypal_lock_invoice(),private.myegl_paypal_lock_job() from public,anon,authenticated;
