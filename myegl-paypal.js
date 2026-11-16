// Customer checkout: prices and payment decisions always come from the backend.
export async function paypalCall(db,body){
 const {data,error}=await db.functions.invoke('myegl-paypal',{body});
 if(error){let message='PayPal is unavailable. Please contact ERSY GLOBAL.';try{const detail=await error.context?.json();if(detail?.error)message=detail.error}catch{}throw new Error(message)}
 if(data?.error)throw new Error(data.error);
 return data;
}
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text||'';return e};
const money=(value,currency)=>currency+' '+Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export async function showPayPal({db,job,user,container}){
 container.append(node('strong','PayPal'));
 const note=node('p','Checking your invoice…');container.append(note);
 try{
  const {data:attempts,error:receiptError}=await db.from('myegl_paypal_orders').select('status,paypal_order_id,capture_id').eq('job_id',job.id).eq('customer_id',user.id).eq('mode','live').in('status',['capturing','pending','review_required']).limit(1);
  if(receiptError)throw new Error('Unable to verify payment status. Please try again.');
  if(attempts?.length){
   const a=attempts[0];note.textContent=a.status==='review_required'?'ERSY GLOBAL is reviewing this payment. Please contact us before making another payment.':'Your PayPal payment is processing. Please do not pay again.';
   if(a.paypal_order_id&&a.status!=='review_required'){const refresh=node('button','Check payment status');refresh.type='button';refresh.onclick=async()=>{refresh.disabled=true;try{const result=await paypalCall(db,{action:'status',order_id:a.paypal_order_id});note.textContent=paymentMessage(result);if(result.status==='completed')location.reload()}catch(e){note.textContent=e.message}finally{refresh.disabled=false}};container.append(refresh)}
   return;
  }
  const {data:invoices,error}=await db.from('myegl_invoices').select('id,invoice_number,status,total,amount_paid,currency').eq('job_id',job.id).eq('customer_id',user.id).in('status',['issued','partially_paid']).order('created_at',{ascending:false});
  if(error)throw new Error('Unable to load your invoice. Please try again.');
  const invoice=invoices?.find(i=>Number(i.total)>Number(i.amount_paid));
  if(!invoice){note.textContent=job.payment_status==='paid'?'This order is paid.':'PayPal payment will be available when ERSY GLOBAL issues your invoice.';return}
  const quote=await paypalCall(db,{action:'quote',invoice_id:invoice.id});
  note.textContent='Invoice '+quote.invoice_number+' · Balance '+money(quote.invoice_amount,quote.invoice_currency);
  container.append(node('p','Pay with PayPal: '+money(quote.amount,quote.currency)));
  if(quote.aed_per_usd)container.append(node('p','Your AED balance is converted at 1 USD = '+quote.aed_per_usd+' AED.'));
  container.append(node('p','Review and confirm your payment on PayPal. Your bank or PayPal may apply currency conversion charges.'));
  const pay=node('button','Continue to PayPal');pay.type='button';container.append(pay);
  const feedback=node('p','');feedback.setAttribute('aria-live','polite');container.append(feedback);
  pay.onclick=async()=>{
   pay.disabled=true;feedback.textContent='Opening secure PayPal checkout…';
   try{
    const result=await paypalCall(db,{action:'create',invoice_id:invoice.id});
    if(result.approval_url){const u=new URL(result.approval_url);if(u.origin!=='https://www.paypal.com')throw new Error('Unable to open PayPal. Please contact ERSY GLOBAL.');location.assign(u.href)}
    else {feedback.textContent=paymentMessage(result);pay.disabled=false}
   }catch(e){feedback.textContent=e.message;pay.disabled=false}
  };
 }catch(e){note.textContent=e.message}
}
export function paymentMessage(result){
 if(result.status==='completed')return 'Payment received. Thank you. PayPal reference: '+result.capture_id;
 if(result.status==='review_required')return 'ERSY GLOBAL is reviewing this payment. Please contact us before paying again.';
 if(result.status==='failed')return 'PayPal did not complete this payment. Please try another payment method.';
 return 'Your PayPal payment is processing. Please do not pay again.';
}
export async function completePayPalReturn({db,container}){
 const q=new URLSearchParams(location.search),state=q.get('payment');
 if(!['paypal','paypal_cancel'].includes(state))return false;
 const token=q.get('token');
 const note=node('p',state==='paypal_cancel'?'PayPal checkout cancelled.':'Confirming your PayPal payment…');note.setAttribute('role','status');container.prepend(note);
 if(state==='paypal_cancel'){
  // Cancellation is not proof of a failed payment. Check an existing order when
  // PayPal supplies its token, in case approval completed before navigation.
  if(token)try{const result=await paypalCall(db,{action:'status',order_id:token});if(['completed','pending','review_required'].includes(result.status))note.textContent=paymentMessage(result)}catch{}
 }else if(token){
  try{const result=await paypalCall(db,{action:'capture',order_id:token});note.textContent=paymentMessage(result)}catch(e){note.textContent=e.message+' Please check payment status before trying again.'}
 }else note.textContent='No PayPal payment reference was received. Please check the payment status.';
 // Preserve the order identity; remove provider query parameters to avoid
 // submitting capture again on an ordinary refresh (server is idempotent too).
 const url=new URL(location.href);for(const key of ['payment','token','PayerID'])url.searchParams.delete(key);history.replaceState(null,'',url);
 return true;
}
