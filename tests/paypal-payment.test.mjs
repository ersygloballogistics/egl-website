import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeHandler,checkoutAmount,PaymentError} from '../supabase/functions/myegl-paypal/core.mjs';
const invoiceID='11111111-1111-4111-8111-111111111111';
const customerID='22222222-2222-4222-8222-222222222222';
const attemptID='33333333-3333-4333-8333-333333333333';
const jobID='44444444-4444-4444-8444-444444444444';
function harness(options={}){
 const env={PAYPAL_MODE:'live',PAYPAL_ENABLED:'true',PAYPAL_LIVE_CLIENT_ID:'fixture-client',PAYPAL_LIVE_CLIENT_SECRET:'fixture-secret',PAYPAL_LIVE_WEBHOOK_ID:'fixture-webhook',...options.env};
 const a={id:attemptID,customer_id:customerID,invoice_id:invoiceID,job_id:jobID,status:'created',paypal_order_id:'ORDER123456789',capture_request_id:'capture-fixture',create_request_id:'create-fixture',paypal_amount:100,paypal_currency:'USD',invoice_amount:367.25,invoice_currency:'AED',...options.attempt};
 let state=options.orderState||'APPROVED',creditCount=0,fetchCount=0,prepared=0,refunded=0;
 const calls=[];
 const order=()=>({id:a.paypal_order_id,intent:'CAPTURE',status:state,purchase_units:[{reference_id:invoiceID,custom_id:attemptID,amount:{value:options.tamperAmount?'1.00':'100.00',currency_code:'USD'},payee:{email_address:options.tamperPayee?'wrong@example.invalid':'sales@ersygloballogistics.com'},payments:state==='COMPLETED'?{captures:[{id:'CAPTURE123456789',status:options.captureState||'COMPLETED',amount:{value:'100.00',currency_code:'USD'}}]}:undefined}],links:[{rel:'payer-action',href:options.badURL?'https://evil.example/checkout':'https://www.paypal.com/checkoutnow?token=ORDER123456789'}]});
 const db={
  async invoice(id,uid){if(options.invoiceRejected||id!==invoiceID||uid!==customerID)throw new PaymentError('Invoice unavailable',409);return {id:invoiceID,invoice_number:'TEST-PAYPAL-001',remaining:367.25,currency:'AED',total:367.25,amount_paid:0}},
  async reserve(){return a},
  async byOrder(id){return id===a.paypal_order_id?a:null},
  async byCapture(){return a},
  async prepare(){prepared++;if(options.changed)throw new PaymentError('Invoice changed',409);a.status='capturing';return a},
  async created(id,order){a.paypal_order_id=order;a.status='created'},
  async review(id,code){a.status='review_required';a.failure_code=code},
  async finish(attempt,capture){if(!a.applied_at&&capture.status==='COMPLETED'){creditCount++;a.applied_at='fixture-time'}a.status=capture.status==='PENDING'?'pending':capture.status==='COMPLETED'?'completed':'failed';a.capture_id=capture.id;return a},
  async refund(){refunded++}
 };
 const fetcher=async(url,init)=>{
  fetchCount++;calls.push({url,init});
  if(url.endsWith('/v1/oauth2/token'))return Response.json({access_token:'fixture-token',expires_in:3600});
  if(url.endsWith('/verify-webhook-signature'))return Response.json({verification_status:options.invalidSignature?'FAILURE':'SUCCESS'});
  if(url.endsWith('/v2/checkout/orders')&&init.method==='POST'){a.paypal_order_id='ORDER123456789';state='CREATED';return Response.json(order())}
  if(url.endsWith('/capture')){state='COMPLETED';if(options.ambiguousCapture)throw new TypeError('fixture timeout');return Response.json(order())}
  if(url.includes('/v2/checkout/orders/'))return Response.json(order());
  if(url.includes('/v2/payments/refunds/'))return Response.json({id:'REFUND123456789',status:'COMPLETED',amount:{value:'50.00',currency_code:'USD'},links:[{rel:'up',href:'https://api-m.paypal.com/v2/payments/captures/CAPTURE123456789'}]});
  throw new Error('Unexpected provider call '+url);
 };
 const handler=makeHandler({db,env:n=>env[n],authenticate:async h=>h==='Bearer fixture'?{id:options.wrongOwner?'other':customerID,email_confirmed_at:'fixture',myegl_approved:options.approved!==false,app_metadata:{myegl_role:options.admin?'admin':'customer'}}:null,fetch:fetcher});
 const request=async(body,extra={})=>handler(new Request('https://fixture.supabase.co/functions/v1/myegl-paypal'+(extra.webhook?'/webhook':''),{method:'POST',headers:{Authorization:'Bearer fixture',Origin:'https://www.ersygloballogistics.com',...extra.headers},body:JSON.stringify(body)}));
 return {request,a,calls,get creditCount(){return creditCount},get fetchCount(){return fetchCount},get prepared(){return prepared},get refunded(){return refunded}};
}
test('AED conversion and supported invoice currencies use exact rounded balances',()=>{
 assert.equal(checkoutAmount({remaining:'367.25',currency:'AED'}).amount,'100.00');
 assert.equal(checkoutAmount({remaining:'50.00',currency:'AED'}).amount,'13.61');
 assert.equal(checkoutAmount({remaining:'12.34',currency:'EUR'}).amount,'12.34');
 assert.throws(()=>checkoutAmount({remaining:'10',currency:'GHS'}));
 assert.throws(()=>checkoutAmount({remaining:'0',currency:'USD'}));
});
test('unauthenticated and foreign-origin requests never reach PayPal',async()=>{
 const h=harness();assert.equal((await h.request({action:'create',invoice_id:invoiceID},{headers:{Authorization:''}})).status,401);
 assert.equal((await h.request({action:'create',invoice_id:invoiceID},{headers:{Origin:'https://evil.example'}})).status,403);assert.equal(h.fetchCount,0);
});
test('disabled or incomplete connection cannot create payments',async()=>{
 const h=harness({env:{PAYPAL_ENABLED:'false'}});const r=await h.request({action:'create',invoice_id:invoiceID});assert.equal(r.status,503);assert.equal(h.fetchCount,0);
});
test('another customer cannot quote or capture an invoice',async()=>{
 const h=harness({wrongOwner:true});assert.equal((await h.request({action:'quote',invoice_id:invoiceID})).status,409);assert.equal((await h.request({action:'capture',order_id:'ORDER123456789'})).status,404);assert.equal(h.fetchCount,0);
});
test('server creates invoice-priced order and ignores client amount and recipient',async()=>{
 const h=harness({attempt:{paypal_order_id:null,status:'creating'}});const r=await h.request({action:'create',invoice_id:invoiceID,amount:0.01,business:'attacker@example.invalid'});assert.equal(r.status,200);
 const payload=JSON.parse(h.calls.find(x=>x.url.endsWith('/v2/checkout/orders')).init.body);
 assert.deepEqual(payload.purchase_units[0].amount,{currency_code:'USD',value:'100.00'});assert.equal(payload.purchase_units[0].payee.email_address,'sales@ersygloballogistics.com');assert.equal(payload.purchase_units[0].custom_id,attemptID);assert.match(payload.payment_source.paypal.experience_context.return_url,/type=job/);assert.equal(h.creditCount,0);
});
test('only verified capture credits invoice; retries do not double credit',async()=>{
 const h=harness();const first=await h.request({action:'capture',order_id:'ORDER123456789'});assert.equal(first.status,200);assert.equal((await first.json()).status,'completed');await h.request({action:'capture',order_id:'ORDER123456789'});assert.equal(h.creditCount,1);assert.equal(h.prepared,1);
});
test('capture timeout is reconciled by provider GET, without repeating payment',async()=>{
 const h=harness({ambiguousCapture:true});assert.equal((await h.request({action:'capture',order_id:'ORDER123456789'})).status,200);assert.equal(h.creditCount,1);assert.equal(h.calls.filter(x=>x.url.endsWith('/capture')).length,1);
});
test('changed invoice is rejected before provider capture',async()=>{
 const h=harness({changed:true});assert.equal((await h.request({action:'capture',order_id:'ORDER123456789'})).status,409);assert.equal(h.calls.filter(x=>x.url.endsWith('/capture')).length,0);assert.equal(h.creditCount,0);
});
test('wrong recipient or altered provider amount never credits payment',async()=>{
 for(const options of [{tamperAmount:true},{tamperPayee:true}]){const h=harness(options);assert.equal((await h.request({action:'capture',order_id:'ORDER123456789'})).status,409);assert.equal(h.a.status,'review_required');assert.equal(h.creditCount,0)}
});
test('pending capture stays pending and status check does not create a new charge',async()=>{
 const h=harness({captureState:'PENDING'});const r=await h.request({action:'capture',order_id:'ORDER123456789'});assert.equal((await r.json()).status,'pending');await h.request({action:'status',order_id:'ORDER123456789'});assert.equal(h.creditCount,0);assert.equal(h.calls.filter(x=>x.url.endsWith('/capture')).length,1);
});
test('missing or invalid webhook signatures are rejected',async()=>{
 const h=harness({invalidSignature:true});const event={event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:'ORDER123456789'}};
 assert.equal((await h.request(event,{webhook:true})).status,401);
 assert.equal((await h.request(event,{webhook:true,headers:{'paypal-auth-algo':'fixture','paypal-cert-url':'https://api.paypal.com/cert','paypal-transmission-id':'fixture','paypal-transmission-sig':'fixture','paypal-transmission-time':'fixture'}})).status,401);assert.equal(h.creditCount,0);
});
test('verified approved webhook reconciles a customer who closed the browser',async()=>{
 const h=harness();const r=await h.request({event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:'ORDER123456789'}},{webhook:true,headers:{'paypal-auth-algo':'fixture','paypal-cert-url':'https://api.paypal.com/cert','paypal-transmission-id':'fixture','paypal-transmission-sig':'fixture','paypal-transmission-time':'fixture'}});assert.equal(r.status,200);assert.equal(h.creditCount,1);
});
test('redirect cannot send a customer to an untrusted site',async()=>{
 const h=harness({badURL:true,attempt:{paypal_order_id:null,status:'creating'}});assert.equal((await h.request({action:'create',invoice_id:invoiceID})).status,502);assert.equal(h.creditCount,0);
});
test('connection health is admin-only and never creates a payment',async()=>{
 const h=harness({admin:true});const r=await h.request({action:'health'});assert.deepEqual(await r.json(),{ready:true,mode:'live',credentials_verified:true,webhook_configured:true,enabled:true});assert.equal(h.calls.length,1);assert.equal((await harness().request({action:'health'})).status,403);
});

test('pending or revoked customer approvals cannot start checkout',async()=>{const h=harness({approved:false});assert.equal((await h.request({action:'create',invoice_id:invoiceID})).status,403);assert.equal(h.fetchCount,0)});

test('invoice quote exposes only the public SDK client ID, never secrets or tokens',async()=>{
 const h=harness();const response=await h.request({action:'quote',invoice_id:invoiceID});const quote=await response.json();assert.equal(response.status,200);assert.equal(quote.client_id,'fixture-client');assert.equal(quote.invoice_id,invoiceID);assert.equal(quote.amount,'100.00');assert.equal(h.fetchCount,0);assert.ok(!JSON.stringify(quote).includes('fixture-secret'));assert.ok(!JSON.stringify(quote).includes('fixture-token'));
});

test('native checkout creates a funding-neutral order with the same locked invoice price',async()=>{
 const h=harness({attempt:{paypal_order_id:null,status:'creating'}});const r=await h.request({action:'create',invoice_id:invoiceID,checkout:'buttons',amount:0.01});assert.equal(r.status,200);
 const payload=JSON.parse(h.calls.find(x=>x.url.endsWith('/v2/checkout/orders')).init.body);assert.equal(payload.payment_source,undefined);assert.deepEqual(payload.purchase_units[0].amount,{currency_code:'USD',value:'100.00'});assert.equal(payload.purchase_units[0].payee.email_address,'sales@ersygloballogistics.com');assert.match(payload.application_context.return_url,/type=job/);assert.equal(h.creditCount,0);
});
