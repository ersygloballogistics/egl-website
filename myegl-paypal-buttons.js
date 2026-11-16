// PayPal-hosted UI only. Invoice prices, recipient and capture stay on the server.
const make=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e};
let scriptReady;
const instances=new Map();
export async function loadPayPalSDK(clientId){
 if(!clientId)throw new Error('PayPal is unavailable. Please contact ERSY GLOBAL.');
 if(!scriptReady){
  scriptReady=new Promise((resolve,reject)=>{
   if(window.paypal?.createInstance){resolve();return}
   const script=document.createElement('script');script.src='https://www.paypal.com/web-sdk/v6/core';script.async=true;
   const timer=setTimeout(()=>{script.remove();reject(new Error('PayPal could not load.'))},20000);
   script.onload=()=>{clearTimeout(timer);if(window.paypal?.createInstance)resolve();else reject(new Error('PayPal could not load.'))};
   script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('PayPal could not load.'))};document.head.append(script);
  }).catch(e=>{scriptReady=undefined;throw e});
 }
 await scriptReady;
 if(!instances.has(clientId))instances.set(clientId,window.paypal.createInstance({clientId,components:['paypal-payments','paypal-guest-payments','venmo-payments'],pageType:'checkout'}).catch(e=>{instances.delete(clientId);throw e}));
 return instances.get(clientId);
}

export async function renderPayPalButtons({quote,container,call,message,onBusy=()=>{},getSDK=loadPayPalSDK,allowedMethods,allowRedirectFallback=true,onUnavailable=()=>{}}){
 const stack=make('div');stack.className='egl-paypal-buttons';
 const feedback=make('p','Loading secure payment options…');feedback.setAttribute('role','status');
 const fallback=make('button','Open PayPal checkout');fallback.type='button';fallback.className='egl-paypal-fallback';fallback.hidden=true;
 container.append(stack,feedback,fallback);
 let busy=false,blocked=false,orderId,approved=false;
 const buttons=[];
 const lock=value=>{busy=value;onBusy(value);stack.inert=value||blocked;for(const b of buttons){b.disabled=value||blocked;b.setAttribute('aria-disabled',String(value||blocked))}fallback.disabled=value||blocked;stack.setAttribute('aria-busy',String(value))};
 const check=async()=>{
  if(!orderId)return;
  const result=await call({action:'status',order_id:orderId});
  blocked=['completed','pending','review_required','capturing'].includes(result.status);
  feedback.textContent=blocked?message(result):'Checkout was not completed. You can try again.';
  lock(false);return result;
 };
 const checkButton=make('button','Check payment status');checkButton.type='button';checkButton.hidden=true;checkButton.className='egl-paypal-fallback';container.append(checkButton);
 checkButton.onclick=async()=>{checkButton.disabled=true;try{await check()}catch{feedback.textContent='Unable to confirm payment status. Please contact ERSY GLOBAL before paying again.'}finally{checkButton.disabled=false}};
 const unavailable=()=>{if(allowRedirectFallback)fallback.hidden=false;else onUnavailable()};
 const uncertain=async()=>{
  if(blocked&&!orderId)return;
  if(!orderId){feedback.textContent='Secure checkout could not open. Please try again or choose another payment method.';unavailable();return}
  blocked=true;checkButton.hidden=false;
  try{await check()}catch{feedback.textContent='Unable to confirm payment status. Please check before paying again.'}
 };
 const createOrder=async()=>{
  const result=await call({action:'create',invoice_id:quote.invoice_id,checkout:'buttons'});
  if(!result.order_id){blocked=['completed','pending','review_required','capturing'].includes(result.status);feedback.textContent=message(result);throw new Error('Payment status changed.');}
  orderId=result.order_id;return {orderId};
 };
 const callbacks={
  onApprove:async data=>{
   // An SDK approval alone is never a paid receipt.
   approved=true;blocked=true;orderId=data.orderId;checkButton.hidden=false;
   feedback.textContent='Confirming your payment…';
   try{const result=await call({action:'capture',order_id:orderId});feedback.textContent=message(result);blocked=['completed','pending','review_required','capturing'].includes(result.status)}
   catch{feedback.textContent='Unable to confirm payment yet. Check payment status before trying again.';throw new Error('Payment confirmation is pending.')}
  },
  onComplete:()=>{lock(false)},
  onCancel:async()=>{if(orderId)await uncertain();else feedback.textContent='Checkout cancelled. You can choose a payment method when ready.';lock(false)},
  onError:async()=>{await uncertain();lock(false)},
  onWarn:()=>{feedback.textContent='Please check the details in the secure PayPal form.'}
 };
 fallback.onclick=async()=>{
  if(busy||blocked)return;lock(true);feedback.textContent='Opening PayPal checkout…';
  try{const result=await call({action:'create',invoice_id:quote.invoice_id});
   if(!result.approval_url){blocked=['completed','pending','review_required','capturing'].includes(result.status);feedback.textContent=message(result);return}
   orderId=result.order_id;const url=new URL(result.approval_url);if(url.origin!=='https://www.paypal.com')throw new Error('Invalid checkout URL.');location.assign(url.href);
  }catch{await uncertain()}finally{lock(false)}
 };
 try{
  const sdk=await getSDK(quote.client_id);
  const eligible=await sdk.findEligibleMethods({currencyCode:quote.currency,amount:quote.amount});
  // Render only options PayPal has approved for this merchant and buyer.
  const methods=[
   ['paypal','paypal-button','createPayPalOneTimePaymentSession','Pay with PayPal'],
   ['card','paypal-basic-card-button','createPayPalGuestOneTimePaymentSession','Pay with debit or credit card'],
   ['paylater','paypal-pay-later-button','createPayLaterOneTimePaymentSession','Pay Later'],
   ['credit','paypal-credit-button','createPayPalCreditOneTimePaymentSession','PayPal Credit'],
   ['venmo','venmo-button','createVenmoOneTimePaymentSession','Pay with Venmo']
  ];
  for(const [method,tag,factory,label] of methods){
   if((allowedMethods&&!allowedMethods.includes(method))||!eligible.isEligible(method)||typeof sdk[factory]!=='function')continue;
   try{
    const session=await sdk[factory](callbacks),button=make(tag);button.setAttribute('type','pay');button.setAttribute('aria-label',label);
    if(method==='paypal')button.className='paypal-gold';
    if(['paylater','credit'].includes(method)){const details=eligible.getDetails(method);if(details?.productCode)button.productCode=details.productCode;if(details?.countryCode)button.countryCode=details.countryCode}
    buttons.push(button);
    if(method==='card'){const wrapper=make('paypal-basic-card-container');wrapper.append(button);stack.append(wrapper)}else stack.append(button);
    button.addEventListener('click',async()=>{
     if(busy||blocked)return;lock(true);approved=false;feedback.textContent='Opening secure checkout…';
     try{
      // Start immediately on the click, before awaiting the server, to keep popup permission.
      await session.start({presentationMode:'auto',targetElement:button},createOrder());
      if(!approved&&!blocked)feedback.textContent='Checkout closed. You can choose a payment method when ready.';
     }catch{await uncertain()}finally{lock(false)}
    });
   }catch{/* One unavailable method must not hide other eligible methods. */}
  }
  feedback.textContent=buttons.length?'':allowRedirectFallback?'PayPal checkout is available in a separate window.':'Card payment is unavailable here. Please choose another method or request a payment link.';
  if(!buttons.length)unavailable();
 }catch{feedback.textContent=allowRedirectFallback?'PayPal buttons could not load. You can open secure PayPal checkout instead.':'Card checkout could not load. Please choose another method or request a payment link.';unavailable()}
 return {isBusy:()=>busy};
}
