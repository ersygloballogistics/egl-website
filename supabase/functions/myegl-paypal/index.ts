import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { makeHandler, PaymentError } from './core.mjs';

const env=(name:string)=>Deno.env.get(name);
const url=env('SUPABASE_URL')!;
const service=createClient(url,env('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name:string,args:Record<string,unknown>){
 const {data,error}=await service.rpc(name,args);
 if(error){
  const allowed=['Invoice unavailable','Approved account required','Invoice is not payable','Payment unavailable','Payment is not ready','Invoice changed; contact ERSY GLOBAL','Please request a PayPal invoice in USD, EUR or GBP'];
  throw new PaymentError(allowed.includes(error.message)?error.message:'Payment requires review. Please contact ERSY GLOBAL.',409,'INVOICE_UNAVAILABLE');
 }
 return data;
}
const db={
 invoice:(id:string,uid:string)=>rpc('myegl_paypal_invoice',{p_invoice_id:id,p_customer_id:uid}),
 reserve:(id:string,uid:string,mode:string)=>rpc('myegl_paypal_reserve',{p_invoice_id:id,p_customer_id:uid,p_mode:mode}),
 prepare:(id:string)=>rpc('myegl_paypal_prepare_capture',{p_attempt_id:id}),
 async byOrder(id:string,mode:string){const {data,error}=await service.from('myegl_paypal_orders').select('*').eq('paypal_order_id',id).eq('mode',mode).maybeSingle();if(error)throw error;return data},
 async byCapture(id:string,mode:string){const {data,error}=await service.from('myegl_paypal_orders').select('*').eq('capture_id',id).eq('mode',mode).maybeSingle();if(error)throw error;return data},
 async created(id:string,order:string){const {error}=await service.from('myegl_paypal_orders').update({paypal_order_id:order,status:'created',updated_at:new Date().toISOString()}).eq('id',id).eq('status','creating');if(error)throw error},
 async review(id:string,code:string){const {error}=await service.from('myegl_paypal_orders').update({status:'review_required',failure_code:code,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error},
 finish:(a:any,c:any)=>rpc('myegl_paypal_finish',{p_attempt_id:a.id,p_order_id:a.paypal_order_id,p_capture_id:c.id,p_amount:c.amount.value,p_currency:c.amount.currency_code,p_status:c.status}),
 refund:(a:any,r:any)=>rpc('myegl_paypal_refund',{p_attempt_id:a.id,p_refund_id:r.id,p_amount:r.amount.value,p_currency:r.amount.currency_code})
};
async function authenticate(header:string|null){
 if(!header?.startsWith('Bearer '))return null;
 const {data,error}=await service.auth.getUser(header.slice(7));if(error||!data.user)return null;
 const userClient=createClient(url,env('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:header}}});
 const {data:profile}=await userClient.from('portal_customers').select('approved').eq('id',data.user.id).maybeSingle();
 return {...data.user,myegl_approved:!!profile?.approved};
}
Deno.serve(makeHandler({db,authenticate,env,log:(event:unknown)=>console.warn(JSON.stringify(event))}));
