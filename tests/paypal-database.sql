begin;
do $$
declare u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); j uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); a jsonb; b jsonb; failed boolean;
begin
 assert not has_function_privilege('anon','public.myegl_paypal_reserve(uuid,uuid,text)','execute');
 assert not has_function_privilege('authenticated','public.myegl_paypal_finish(uuid,text,text,numeric,text,text)','execute');
 assert has_function_privilege('service_role','public.myegl_paypal_reserve(uuid,uuid,text)','execute');
 assert not has_table_privilege('authenticated','public.myegl_paypal_orders','insert');
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values(u,'paypal-test-'||u||'@example.invalid',now(),'{}','{}');
 update public.portal_customers set approved=true,review_status='approved' where id=u;
 insert into public.portal_jobs(id,zoho_record_id,reference,customer_id,customer_email,service_type,currency,quoted_total,quote_status,payment_status)
 values(j,'TEST-PAYPAL-'||j,'TEST-PAYPAL-'||j,u,'paypal-test-'||u||'@example.invalid','freight','AED',367.25,'approved','pending');
 insert into public.myegl_invoices(id,job_id,invoice_number,customer_id,customer_email,currency,subtotal,total,amount_paid,status,issued_at,due_date)
 values(i,j,'TEST-PAYPAL-'||i,u,'paypal-test-'||u||'@example.invalid','AED',367.25,367.25,0,'issued',now(),current_date+7);
 failed:=false;begin perform public.myegl_paypal_invoice(i,other_u);exception when others then failed:=true;end;assert failed,'Wrong customer was allowed';
 update public.portal_customers set approved=false where id=u;
 failed:=false;begin perform public.myegl_paypal_reserve(i,u,'live');exception when others then failed:=true;end;assert failed,'Pending customer was allowed';
 update public.portal_customers set approved=true where id=u;
 failed:=false;begin perform public.myegl_paypal_reserve(i,u,'sandbox');exception when others then failed:=true;end;assert failed,'Sandbox could use a live invoice';
 a:=public.myegl_paypal_reserve(i,u,'live');
 assert (a->>'paypal_amount')::numeric=100;
 assert (a->>'invoice_amount')::numeric=367.25;
 b:=public.myegl_paypal_reserve(i,u,'live');assert a->>'id'=b->>'id','Concurrent reservation was not reused';
 update public.myegl_paypal_orders set paypal_order_id='TESTORDER12345678',status='created' where id=(a->>'id')::uuid;
 b:=public.myegl_paypal_prepare_capture((a->>'id')::uuid);assert b->>'status'='capturing';
 failed:=false;begin update public.myegl_invoices set total=400 where id=i;exception when others then failed:=true;end;assert failed,'Invoice changed during capture';
 failed:=false;begin update public.portal_jobs set quoted_total=400 where id=j;exception when others then failed:=true;end;assert failed,'Quote changed during capture';
 failed:=false;begin perform public.myegl_paypal_finish((a->>'id')::uuid,'TESTORDER12345678','TESTCAPTURE123456',1,'USD','COMPLETED');exception when others then failed:=true;end;assert failed,'Wrong capture amount was credited';
 b:=public.myegl_paypal_finish((a->>'id')::uuid,'TESTORDER12345678','TESTCAPTURE123456',100,'USD','PENDING');
 assert b->>'status'='pending';assert (select amount_paid=0 from public.myegl_invoices where id=i);
 b:=public.myegl_paypal_finish((a->>'id')::uuid,'TESTORDER12345678','TESTCAPTURE123456',100,'USD','COMPLETED');
 assert b->>'status'='completed';assert (select amount_paid=367.25 and status='paid' from public.myegl_invoices where id=i);
 assert (select payment_status='paid' from public.portal_jobs where id=j);
 b:=public.myegl_paypal_finish((a->>'id')::uuid,'TESTORDER12345678','TESTCAPTURE123456',100,'USD','COMPLETED');
 assert (select amount_paid=367.25 from public.myegl_invoices where id=i),'Replay double-credited invoice';
 b:=public.myegl_paypal_refund((a->>'id')::uuid,'TESTREFUND1234567',50,'USD');
 assert b->>'status'='review_required';assert (select amount_paid=183.62 and status='partially_paid' from public.myegl_invoices where id=i);
 b:=public.myegl_paypal_refund((a->>'id')::uuid,'TESTREFUND1234567',50,'USD');
 assert (select amount_paid=183.62 from public.myegl_invoices where id=i),'Refund replay changed balance';
 b:=public.myegl_paypal_refund((a->>'id')::uuid,'TESTREFUND7654321',50,'USD');
 assert (select amount_paid=0 and status='issued' from public.myegl_invoices where id=i);
 assert (select payment_status='refunded' from public.portal_jobs where id=j);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 assert (select count(*)=1 from public.myegl_paypal_orders where id=(a->>'id')::uuid),'Customer cannot view their receipt';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_u,'role','authenticated')::text,true);
 assert (select count(*)=0 from public.myegl_paypal_orders where id=(a->>'id')::uuid),'Another customer can view receipt';
 execute 'reset role';
 raise notice 'PayPal database checks passed; fixture transaction will roll back';
end $$;
rollback;
