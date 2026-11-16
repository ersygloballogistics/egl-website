// No provider credentials or customer card details are returned to the browser.
export class PaymentError extends Error {
  constructor(message, status = 400, code = 'PAYMENT_UNAVAILABLE') { super(message); this.status = status; this.code = code; }
}
const origins = new Set(['https://www.ersygloballogistics.com','https://ersygloballogistics.com']);
const uuidRE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const providerID = /^[A-Z0-9]{8,40}$/;
export function cents(value) {
  const s = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(s) || Number(value)>1e9) throw new PaymentError('Invalid payment amount');
  const [a,b=''] = s.split('.'); return BigInt(a)*100n + BigInt(b.padEnd(2,'0'));
}
export function decimal(value) { return `${value/100n}.${String(value%100n).padStart(2,'0')}`; }
export function checkoutAmount(invoice) {
  const value = cents(invoice.remaining);
  if (value<=0n) throw new PaymentError('This invoice has no balance to pay.');
  if (invoice.currency==='AED') {
    const usd = (value*20000n+36725n)/73450n;
    if (usd<1n) throw new PaymentError('This amount is below the PayPal minimum.');
    return {amount:decimal(usd),currency:'USD',invoice_amount:decimal(value),invoice_currency:'AED',aed_per_usd:'3.6725'};
  }
  if (!['USD','EUR','GBP'].includes(invoice.currency)) throw new PaymentError('Please contact ERSY GLOBAL for a PayPal invoice in USD, EUR or GBP.');
  return {amount:decimal(value),currency:invoice.currency,invoice_amount:decimal(value),invoice_currency:invoice.currency,aed_per_usd:null};
}
function safeApproval(order,mode) {
  const value = order.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;
  let u;try{u=new URL(value)}catch{throw new PaymentError('Unable to open PayPal. Please try again.',502)}
  const host=mode==='live'?'www.paypal.com':'www.sandbox.paypal.com';
  if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password) throw new PaymentError('Invalid PayPal checkout address.',502);
  return u.href;
}
function receipt(a) { return {status:a.status,capture_id:a.capture_id||null,amount:String(a.paypal_amount),currency:a.paypal_currency,invoice_id:a.invoice_id}; }
export function verifyOrder(order,a,email) {
  const units=order.purchase_units;
  if(order.id!==a.paypal_order_id||order.intent!=='CAPTURE'||!Array.isArray(units)||units.length!==1) throw new PaymentError('Payment verification failed.',409,'VERIFICATION_MISMATCH');
  const u=units[0];
  if(u.reference_id!==a.invoice_id||u.custom_id!==a.id||u.amount?.currency_code!==a.paypal_currency||cents(u.amount?.value)!==cents(a.paypal_amount)
    ||String(u.payee?.email_address||'').toLowerCase()!==email.toLowerCase()) throw new PaymentError('Payment verification failed.',409,'VERIFICATION_MISMATCH');
  return u;
}
export function makeHandler({db,authenticate,env,fetch:fetcher=fetch,log=()=>{}}) {
  const get=n=>env(n)||'';
  const mode=get('PAYPAL_MODE');
  const base=mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  const prefix=mode==='live'?'PAYPAL_LIVE_':'PAYPAL_SANDBOX_';
  const client=get(prefix+'CLIENT_ID'),secret=get(prefix+'CLIENT_SECRET'),webhook=get(prefix+'WEBHOOK_ID');
  const receiver=get('PAYPAL_RECEIVER_EMAIL')||'sales@ersygloballogistics.com';
  const ready=mode==='live'&&!!client&&!!secret&&!!webhook&&get('PAYPAL_ENABLED')==='true';
  let cachedToken='',tokenUntil=0;
  async function token() {
    if(cachedToken&&Date.now()<tokenUntil)return cachedToken;
    const r=await fetcher(base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+btoa(client+':'+secret),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)});
    const data=await r.json();
    if(!r.ok||!data.access_token)throw new PaymentError('PayPal connection is unavailable. Please contact ERSY GLOBAL.',503,'PROVIDER_AUTH');
    cachedToken=data.access_token;tokenUntil=Date.now()+Math.max(0,Number(data.expires_in||60)-30)*1000;return cachedToken;
  }
  async function api(path,method='GET',body,requestID) {
    const r=await fetcher(base+path,{method,headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json',Prefer:'return=representation',...(requestID?{'PayPal-Request-ID':requestID}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
    const data=await r.json();
    if(!r.ok){const issue=data.details?.[0]?.issue||data.name||'PAYPAL_ERROR';log({event:'paypal_error',code:issue,debug_id:data.debug_id});throw new PaymentError('PayPal could not complete this step. Please retry or contact ERSY GLOBAL.',502,issue)}
    return data;
  }
  async function reconcile(a,{allowCapture=false}={}) {
    if(a.applied_at)return receipt(a);
    if(!a.paypal_order_id)return receipt(a);
    let order=await api('/v2/checkout/orders/'+a.paypal_order_id);
    let u;
    try {u=verifyOrder(order,a,receiver)}catch(e){await db.review(a.id,e.code);throw e}
    if(order.status==='APPROVED'&&allowCapture){
      a=await db.prepare(a.id);
      if(a.applied_at)return receipt(a);
      try{order=await api('/v2/checkout/orders/'+a.paypal_order_id+'/capture','POST',{},a.capture_request_id)}catch(e){
        // A timeout or duplicate request may have captured funds. Read the order
        // before retrying; never release the invoice lock on an uncertain result.
        order=await api('/v2/checkout/orders/'+a.paypal_order_id);
        if(order.status!=='COMPLETED')throw e;
      }
      try{u=verifyOrder(order,a,receiver)}catch(e){await db.review(a.id,e.code);throw e}
    }
    const captures=u.payments?.captures||[];
    if(captures.length>1){await db.review(a.id,'MULTIPLE_CAPTURES');throw new PaymentError('Payment is being reviewed by ERSY GLOBAL.',409)}
    const capture=captures[0];
    if(capture){
      if(!providerID.test(capture.id||'')||capture.amount?.currency_code!==a.paypal_currency||cents(capture.amount?.value)!==cents(a.paypal_amount)){
        await db.review(a.id,'CAPTURE_MISMATCH');throw new PaymentError('Payment verification failed.',409);
      }
      if(['COMPLETED','PENDING','DECLINED','FAILED'].includes(capture.status))a=await db.finish(a,capture);
      else if(['REFUNDED','PARTIALLY_REFUNDED'].includes(capture.status))await db.review(a.id,'REFUND_RECONCILIATION');
    }
    return receipt(a);
  }
  async function webhookRequest(req,body) {
    if(!client||!secret||!webhook||mode!=='live')throw new PaymentError('Webhook is not configured.',503);
    const headers=['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'];
    if(headers.some(h=>!req.headers.get(h)))throw new PaymentError('Missing webhook signature.',401);
    const result=await api('/v1/notifications/verify-webhook-signature','POST',{
      auth_algo:req.headers.get(headers[0]),cert_url:req.headers.get(headers[1]),transmission_id:req.headers.get(headers[2]),
      transmission_sig:req.headers.get(headers[3]),transmission_time:req.headers.get(headers[4]),webhook_id:webhook,webhook_event:body
    });
    if(result.verification_status!=='SUCCESS')throw new PaymentError('Invalid webhook signature.',401);
    const type=String(body.event_type||'');
    if(!['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'].includes(type))return {ok:true};
    const resource=body.resource||{};
    let orderID=resource.supplementary_data?.related_ids?.order_id;
    if(type==='CHECKOUT.ORDER.APPROVED')orderID=resource.id;
    let a=orderID&&providerID.test(orderID)?await db.byOrder(orderID,mode):null;
    if(type==='PAYMENT.CAPTURE.REFUNDED'){
      if(!providerID.test(resource.id||''))throw new PaymentError('Invalid refund event.',400);
      const refund=await api('/v2/payments/refunds/'+resource.id);
      if(refund.status!=='COMPLETED')return {ok:true};
      const up=refund.links?.find(x=>x.rel==='up')?.href;
      let match;try{const u=new URL(up);if(u.origin===base)match=u.pathname.match(/^\/v2\/payments\/captures\/([A-Z0-9]{8,40})$/)}catch{}
      if(!match)throw new PaymentError('Refund capture unavailable.',409);
      a=await db.byCapture(match[1],mode);
      if(a)await db.refund(a,refund);
    }else if(a){
      if(type==='PAYMENT.CAPTURE.REVERSED')await db.review(a.id,'PAYMENT_REVERSED');
      else await reconcile(a,{allowCapture:type==='CHECKOUT.ORDER.APPROVED'});
    }
    return {ok:true};
  }
  return async req=>{
    const origin=req.headers.get('Origin');
    const cors={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})};
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
    try{
      if(req.method==='OPTIONS')return new Response(null,{status:origins.has(origin)?204:403,headers:cors});
      if(req.method!=='POST')throw new PaymentError('Use POST.',405);
      if(origin&&!origins.has(origin))throw new PaymentError('Origin unavailable.',403);
      const raw=await req.text();if(raw.length>65536)throw new PaymentError('Request too large.',413);
      let body;try{body=JSON.parse(raw)}catch{throw new PaymentError('Invalid request.',400)}
      if(new URL(req.url).pathname.endsWith('/webhook'))return reply(await webhookRequest(req,body));
      const user=await authenticate(req.headers.get('Authorization'));
      if(!user?.id||!user.email_confirmed_at)throw new PaymentError('Please sign in to MyEGL.',401);
      const action=body.action;
      if(action==='health'){
        if(user.app_metadata?.myegl_role!=='admin')throw new PaymentError('Administrator access required.',403);
        let verified=false;if(client&&secret&&mode==='live'){await token();verified=true}
        return reply({ready,mode:mode||'disabled',credentials_verified:verified,webhook_configured:!!webhook,enabled:get('PAYPAL_ENABLED')==='true'});
      }
      if(!user.myegl_approved)throw new PaymentError('Approved account required.',403);
      if(!ready)throw new PaymentError('PayPal checkout is being set up. Please use bank transfer or contact ERSY GLOBAL.',503,'NOT_CONFIGURED');
      if(action==='quote'||action==='create'){
        if(!uuidRE.test(body.invoice_id||''))throw new PaymentError('Select an issued invoice.',400);
        const invoice=await db.invoice(body.invoice_id,user.id);
        const amount=checkoutAmount(invoice);
        if(action==='quote')return reply({...amount,invoice_id:invoice.id,invoice_number:invoice.invoice_number,mode,client_id:client});
        let a=await db.reserve(invoice.id,user.id,mode);
        if(['capturing','pending','review_required'].includes(a.status))return reply({...receipt(a),message:'Your payment is processing or under review. Please do not pay again.'});
        if(!a.paypal_order_id){
          const returnURL=new URL('https://www.ersygloballogistics.com/myegl/order/');
          returnURL.searchParams.set('type','job');returnURL.searchParams.set('id',a.job_id);returnURL.searchParams.set('payment','paypal');
          const cancelURL=new URL(returnURL);cancelURL.searchParams.set('payment','paypal_cancel');
          const created=await api('/v2/checkout/orders','POST',{
            intent:'CAPTURE',purchase_units:[{reference_id:a.invoice_id,custom_id:a.id,invoice_id:invoice.invoice_number+'-'+a.id,
              description:'ERSY GLOBAL '+invoice.invoice_number,payee:{email_address:receiver},amount:{currency_code:a.paypal_currency,value:decimal(cents(a.paypal_amount))}}],
            // SDK sessions select the eligible funding method. Keep native orders neutral.
            ...(body.checkout==='buttons'
              ?{application_context:{brand_name:'ERSY GLOBAL',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:returnURL.href,cancel_url:cancelURL.href}}
              :{payment_source:{paypal:{experience_context:{brand_name:'ERSY GLOBAL',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:returnURL.href,cancel_url:cancelURL.href}}}})
          },a.create_request_id);
          if(!providerID.test(created.id||''))throw new PaymentError('Invalid PayPal order.',502);
          // Validate the URL before persisting, and persist before returning it.
          const approval=safeApproval(created,mode);await db.created(a.id,created.id);
          return reply({order_id:created.id,approval_url:approval,...amount});
        }
        const order=await api('/v2/checkout/orders/'+a.paypal_order_id);
        verifyOrder(order,a,receiver);
        if(['COMPLETED','APPROVED'].includes(order.status))return reply(await reconcile(a,{allowCapture:true}));
        return reply({order_id:a.paypal_order_id,approval_url:safeApproval(order,mode),...amount});
      }
      if(action==='capture'||action==='status'){
        if(!providerID.test(body.order_id||''))throw new PaymentError('Invalid payment reference.',400);
        const a=await db.byOrder(body.order_id,mode);
        if(!a||a.customer_id!==user.id)throw new PaymentError('Payment unavailable.',404);
        if(a.status==='review_required')return reply(receipt(a));
        if(!a.applied_at)await db.invoice(a.invoice_id,user.id);
        return reply(await reconcile(a,{allowCapture:action==='capture'}));
      }
      throw new PaymentError('Invalid payment action.',400);
    }catch(e){
      if(e instanceof PaymentError)return reply({error:e.message,code:e.code},e.status);
      log({event:'payment_service_error',type:e?.name||'Error'});
      return reply({error:'Unable to complete the payment step. Please retry or contact ERSY GLOBAL.',code:'SERVICE_ERROR'},503);
    }
  };
}

