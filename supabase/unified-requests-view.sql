create or replace view public.myegl_admin_requests with (security_invoker=true) as
select
 'job'::text as record_type, j.id as record_id,
 coalesce(r.reference,j.reference) as reference, j.reference as order_reference,
 j.customer_id, lower(j.customer_email) as customer_email,
 j.service_type,j.origin,j.destination,
 coalesce(r.status,case when j.quote_status='not_quoted' then 'submitted' else 'quoted' end) as request_status,
 j.quote_status,j.shipment_status,coalesce(r.created_at,j.created_at) as created_at,
 coalesce(j.archived_at,r.archived_at) as archived_at,
 c.id as account_id,c.approved,c.review_status
from public.portal_jobs j
left join public.myegl_rfqs r on r.id=j.linked_rfq_id
left join public.portal_customers c on c.id=j.customer_id or (j.customer_id is null and c.email=lower(j.customer_email))
where (select auth.jwt()->'app_metadata'->>'myegl_role')='admin'
union all
select
 'rfq'::text,r.id,r.reference,null::text,r.customer_id,c.email,
 r.service_type,r.origin,r.destination,r.status,null::text,null::text,r.created_at,r.archived_at,
 c.id,c.approved,c.review_status
from public.myegl_rfqs r
left join public.portal_customers c on c.id=r.customer_id
where (select auth.jwt()->'app_metadata'->>'myegl_role')='admin'
 and not exists(select 1 from public.portal_jobs j where j.linked_rfq_id=r.id);
revoke all on public.myegl_admin_requests from public,anon,authenticated;
grant select on public.myegl_admin_requests to authenticated;
comment on view public.myegl_admin_requests is 'Administrator-only unified request inbox; linked portal requests and orders appear once. Underlying row-level security applies.';

