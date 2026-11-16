create or replace view public.myegl_admin_customers
with (security_invoker=true) as
with requests as (
  select lower(trim(customer_email)) as email, count(*) as request_count,
         min(created_at) as first_request_at, max(created_at) as last_request_at
  from public.myegl_admin_requests
  where customer_email is not null and trim(customer_email)<>''
  group by lower(trim(customer_email))
)
select c.id, coalesce(lower(trim(c.email)),r.email) as email,
       c.customer_number, coalesce(c.approved,false) as approved,
       case when c.id is null then 'not_registered' else c.review_status end as review_status,
       coalesce(c.created_at,r.first_request_at) as created_at,
       coalesce(r.request_count,0) as request_count, r.last_request_at
from public.portal_customers c
full join requests r on r.email=lower(trim(c.email))
where (select auth.jwt()->'app_metadata'->>'myegl_role')='admin'
  and coalesce(lower(trim(c.email)),r.email) is not null
  and coalesce(lower(trim(c.email)),r.email)<>'admin@ersygloballogistics.com'
  and c.id is distinct from (select auth.uid());
revoke all on public.myegl_admin_customers from public,anon,authenticated;
grant select on public.myegl_admin_customers to authenticated;
