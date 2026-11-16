import {createPaymentMethods} from './myegl-payment-methods.js?v=20261117c';
import {renderPayPalButtons} from './myegl-paypal-buttons.js?v=20261117c';
// Customer checkout: prices and payment decisions always come from the backend.
export async function paypalCall(db,body){
 const {data,error}=await db.functions.invoke('myegl-paypal',{body});
 if(error){let message='PayPal is unavailable. Please contact ERSY GLOBAL.';try{const detail=await error.context?.json();if(detail?.error)message=detail.error}catch{}throw new Error(message)}
 if(data?.error)throw new Error(data.error);
 return data;
}
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text||'';return e};
const money=(value,currency)=>currency+' '+Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export async function showPayPal({db,job,user,container,invoiceId,onBusy,method}){
 container.classList.add('egl-paypal-checkout');
 if(!method)container.append(node('strong','PayPal'));
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
  const invoice=invoices?.find(i=>(!invoiceId||i.id===invoiceId)&&Number(i.total)>Number(i.amount_paid));
  if(!invoice){note.textContent=job.payment_status==='paid'?'This order is paid.':'Payment options will be available when ERSY GLOBAL issues your invoice.';return}
  const quote=await paypalCall(db,{action:'quote',invoice_id:invoice.id});
  if(method==='card'){
   note.className='egl-card-total';note.textContent='Total to pay: '+money(quote.amount,quote.currency);
   const reference=node('small','Invoice '+quote.invoice_number+' · '+money(quote.invoice_amount,quote.invoice_currency));reference.className='egl-card-reference';container.append(reference);
   if(quote.aed_per_usd){const conversion=node('details');conversion.className='egl-card-conversion';conversion.append(node('summary','Exchange rate and fees'),node('p','1 USD = '+quote.aed_per_usd+' AED. PayPal or your bank may apply currency conversion charges.'));container.append(conversion)}
  }else{
   note.textContent='Invoice '+quote.invoice_number+' · Balance '+money(quote.invoice_amount,quote.invoice_currency);
   container.append(node('p','Pay with PayPal: '+money(quote.amount,quote.currency)));
   if(quote.aed_per_usd)container.append(node('p','Your AED balance is converted at 1 USD = '+quote.aed_per_usd+' AED.'));
   container.append(node('p','Review and confirm your payment on PayPal. Currency conversion charges may apply.'));
  }
  return await renderPayPalButtons({quote,container,call:body=>paypalCall(db,body),message:paymentMessage,onBusy,
   allowedMethods:method==='card'?['card']:method==='paypal'?['paypal','paylater','credit','venmo']:undefined,
   autoOpenMethod:method==='card'?'card':undefined,
   allowRedirectFallback:method!=='card',onUnavailable:()=>{if(method==='card')appendCardLinkRequest({db,job,container})}
  });
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


// A single checkout selection covers invoices from both public requests and portal requests.
export async function showAccountPayments({db,user,container,invoices,jobs}){
 container.replaceChildren();container.className='egl-invoice-payments';
 container.append(node('h3','Invoices and payments'));
 const payable=(invoices||[]).filter(i=>['issued','partially_paid'].includes(i.status)&&Number(i.total)>Number(i.amount_paid));
 if(!payable.length){container.append(node('p','No unpaid issued invoices. Payment methods appear here when ERSY GLOBAL issues your invoice.'));return}
 const label=node('label','Choose an invoice to pay'),select=node('select');select.id='myegl-payment-invoice';label.htmlFor=select.id;
 const jobMap=new Map((jobs||[]).map(j=>[j.id,j]));
 for(const invoice of payable){const option=node('option',invoice.invoice_number+' · '+money(Number(invoice.total)-Number(invoice.amount_paid),invoice.currency)+' · '+(jobMap.get(invoice.job_id)?.reference||'Order'));option.value=invoice.id;select.append(option)}
 const checkout=node('div');container.append(label,select,checkout);
 const render=async()=>{
  const invoice=payable.find(i=>i.id===select.value);if(!invoice)return;
  const job=jobMap.get(invoice.job_id);checkout.replaceChildren();
  if(!job){checkout.append(node('p','Unable to load this order. Please refresh or contact ERSY GLOBAL.'));return}
  const link=node('a','View order and invoice');link.href='/myegl/order/?type=job&id='+encodeURIComponent(job.id);checkout.append(link);
  const pane=node('div');checkout.append(pane);
  showPaymentMethods({db,job,user,container:pane,invoiceId:invoice.id,onBusy:busy=>{select.disabled=busy}});
 };
 select.onchange=render;await render();
}

function appendCardLinkRequest({db,job,container}){
 if(container.querySelector('.egl-card-link-request'))return;
 const request=node('button','Request a card payment link');request.type='button';request.className='egl-card-link-request';
 const status=node('p');status.setAttribute('role','status');container.append(request,status);
 request.onclick=async()=>{
  request.disabled=true;status.textContent='Submitting your request…';
  try{const {data,error}=await db.rpc('myegl_request_stripe_link',{p_job_id:job.id});
   if(error||!data?.ok)throw new Error('Unable to submit your request. Please try again.');
   request.textContent='Payment link requested';status.textContent='ERSY GLOBAL will contact you with your secure payment link.';
  }catch{status.textContent='Unable to request a card payment link. Please try again or contact ERSY GLOBAL.';request.disabled=false}
 };
}
export function showPaymentMethods({db,job,user,container,invoiceId,onBusy,showHeading=true}){
 container.classList.add('egl-payment-checkout');
 return createPaymentMethods({
  container,onBusy,showHeading,
  renderCard:(panel,setBusy)=>showPayPal({db,job,user,container:panel,invoiceId,method:'card',onBusy:setBusy}),
  renderPayPal:(panel,setBusy)=>showPayPal({db,job,user,container:panel,invoiceId,method:'paypal',onBusy:setBusy}),
  renderBank:panel=>{
   if(job.payment_status==='paid'){panel.append(node('p','This order is paid.'));return}
   const bank=node('dl');bank.className='egl-bank-details';
   for(const [label,value] of [['Account holder','ESTHER AMINU'],['Bank','Dubai Islamic Bank (DIB)'],['IBAN','AE730240001523243259701'],['Account number','001523243259701'],['Payment reference',job.reference]]){
    bank.append(node('dt',label),node('dd',value||'Please contact ERSY GLOBAL'));
   }
   panel.append(bank,node('p','Please include the payment reference in your transfer description.'));
  }
 });
}
