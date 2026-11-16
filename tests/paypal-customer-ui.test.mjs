import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderPayPalButtons} from '../myegl-paypal-buttons.js';
import {showPayPal,showAccountPayments,completePayPalReturn} from '../myegl-paypal.js';
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.attrs={};this.classList={add(){},remove(){}};this.value='';this.listeners={};this.disabled=false}
 append(...c){this.children.push(...c);if(this.tag==='select'&&!this.value)this.value=c[0]?.value||''}
 prepend(...c){this.children.unshift(...c)}
 replaceChildren(...c){this.children=c}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(name,callback){this.listeners[name]=callback}
 all(){return [this,...this.children.flatMap(c=>c.all())]}
 click(){return this.listeners.click?.()||this.onclick?.()}
}
const quote={client_id:'public-fixture-client',invoice_id:'invoice',invoice_number:'INV-TEST',invoice_amount:'50.00',invoice_currency:'AED',amount:'13.61',currency:'USD',aed_per_usd:'3.6725'};
function setup({attempts=[],invoices=[{id:'invoice',job_id:'job',invoice_number:'INV-TEST',status:'issued',total:50,amount_paid:0,currency:'AED'}],result={status:'completed',capture_id:'CAPTURE-TEST'},invokeError}={}){
 globalThis.document={createElement:tag=>new Element(tag)};
 globalThis.location={search:'',href:'https://www.ersygloballogistics.com/myegl/order/?type=job&id=test',assign:url=>{globalThis.assigned=url},reload:()=>{}};
 globalThis.history={replaceState:(state,title,url)=>{globalThis.replaced=url.href}};
 const calls=[];
 const db={from(table){const value={data:table==='myegl_paypal_orders'?attempts:invoices,error:null};const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,then:(a,b)=>Promise.resolve(value).then(a,b)};return q},functions:{invoke:async(name,{body})=>{calls.push(body);if(invokeError)return{error:invokeError};return {data:body.action==='quote'?quote:result}}}};
 const container=new Element('div');return {db,calls,container,run:()=>showPayPal({db,job:{id:'job',payment_status:'pending'},user:{id:'user'},container})};
}
function sdkFixture(methods=['paypal','card'],flow=async()=>{}){
 const sessions={},startCalls=[];
 const sdk={async findEligibleMethods(options){assert.deepEqual(options,{currencyCode:'USD',amount:'13.61'});return {isEligible:key=>methods.includes(key),getDetails:key=>({productCode:'PAY_IN_4',countryCode:'US'})}}};
 for(const [key,factory] of [['paypal','createPayPalOneTimePaymentSession'],['card','createPayPalGuestOneTimePaymentSession'],['paylater','createPayLaterOneTimePaymentSession'],['credit','createPayPalCreditOneTimePaymentSession'],['venmo','createVenmoOneTimePaymentSession']]){
  sdk[factory]=callbacks=>{sessions[key]=callbacks;return {async start(options,promise){startCalls.push({key,options,promise});const data=await promise;await flow(callbacks,data,key)}}};
 }
 return {sdk,sessions,startCalls};
}
test('eligible native buttons use the exact server invoice and verified capture result',async()=>{
 const h=setup(),f=sdkFixture(['paypal','card','paylater','credit','venmo'],async(callbacks,data)=>{assert.deepEqual(data,{orderId:'ORDER-TEST'});await callbacks.onApprove({orderId:data.orderId});callbacks.onComplete()});
 const calls=[];await renderPayPalButtons({quote,container:h.container,getSDK:async id=>{assert.equal(id,quote.client_id);return f.sdk},message:r=>'verified:'+r.status,call:async body=>{calls.push(body);return body.action==='create'?{order_id:'ORDER-TEST'}:{status:'completed'}}});
 assert.equal(f.startCalls.length,0); // Rendering never creates an order or charge.
 assert.deepEqual(h.container.all().filter(e=>e.tag.endsWith('-button')).map(e=>e.tag),['paypal-button','paypal-basic-card-button','paypal-pay-later-button','paypal-credit-button','venmo-button']);
 assert.equal(h.container.all().find(e=>e.tag==='paypal-pay-later-button').productCode,'PAY_IN_4');
 await h.container.all().find(e=>e.tag==='paypal-basic-card-button').click();
 assert.deepEqual(calls,[{action:'create',invoice_id:'invoice',checkout:'buttons'},{action:'capture',order_id:'ORDER-TEST'}]);
 assert.ok(h.container.all().some(e=>e.textContent==='verified:completed'));
 assert.equal(h.container.all().find(e=>e.tag==='paypal-button').disabled,true);
});
test('unavailable funding methods stay hidden and SDK failure provides a safe redirect fallback',async()=>{
 const h=setup();await renderPayPalButtons({quote,container:h.container,call:async()=>({order_id:'ORDER',approval_url:'https://www.paypal.com/checkoutnow?token=TEST'}),message:()=>'',getSDK:async()=>{throw new Error('network')}});
 assert.equal(h.container.all().filter(e=>e.tag==='paypal-button').length,0);const fallback=h.container.all().find(e=>e.textContent==='Open PayPal checkout');assert.equal(fallback.hidden,false);await fallback.click();assert.equal(globalThis.assigned,'https://www.paypal.com/checkoutnow?token=TEST');
 const other=setup(),f=sdkFixture(['paypal']);await renderPayPalButtons({quote,container:other.container,call:async()=>({}),message:()=>'',getSDK:async()=>f.sdk});assert.equal(other.container.all().filter(e=>e.tag==='paypal-basic-card-button').length,0);
});
test('double click across funding methods cannot create competing orders',async()=>{
 const h=setup(),f=sdkFixture();let resolve,calls=0;const wait=new Promise(r=>{resolve=r});const busy=[];
 await renderPayPalButtons({quote,container:h.container,call:async()=>{calls++;await wait;return {order_id:'ORDER'}},message:()=>'',getSDK:async()=>f.sdk,onBusy:v=>busy.push(v)});
 const one=h.container.all().find(e=>e.tag==='paypal-button'),two=h.container.all().find(e=>e.tag==='paypal-basic-card-button');const pending=one.click();await two.click();assert.equal(calls,1);assert.equal(two.disabled,true);resolve();await pending;assert.equal(one.disabled,false);assert.deepEqual(busy,[true,false]);
});
test('pending or uncertain capture blocks repayment until server status is checked',async()=>{
 const h=setup(),f=sdkFixture(['paypal'],async c=>{await c.onApprove({orderId:'ORDER'});c.onComplete()});
 await renderPayPalButtons({quote,container:h.container,getSDK:async()=>f.sdk,message:r=>'verified:'+r.status,call:async b=>b.action==='create'?{order_id:'ORDER'}:{status:'pending'}});
 const b=h.container.all().find(e=>e.tag==='paypal-button');await b.click();assert.equal(b.disabled,true);assert.ok(h.container.all().some(e=>e.textContent==='verified:pending'));assert.equal(h.container.all().find(e=>e.textContent==='Check payment status').hidden,false);
});
test('cancellation checks for a payment completed by webhook before re-enabling',async()=>{
 const h=setup(),f=sdkFixture(['paypal'],c=>c.onCancel());const calls=[];await renderPayPalButtons({quote,container:h.container,getSDK:async()=>f.sdk,message:r=>'verified:'+r.status,call:async b=>{calls.push(b);return b.action==='create'?{order_id:'ORDER'}:{status:'completed'}}});const b=h.container.all().find(e=>e.tag==='paypal-button');await b.click();assert.deepEqual(calls.map(x=>x.action),['create','status']);assert.equal(b.disabled,true);
});
test('unissued invoices and reviewed receipts never initialize checkout',async()=>{
 for(const config of [{invoices:[]},{attempts:[{status:'review_required'}],invoices:[]}]){const h=setup(config);await h.run();assert.equal(h.calls.length,0);assert.equal(h.container.all().filter(e=>e.tag==='paypal-button').length,0)}
});
test('account payment selector includes invoices for both public and portal orders',async()=>{
 const invoices=[{id:'one',job_id:'one',status:'issued',total:50,amount_paid:0,currency:'AED',invoice_number:'PUBLIC'},{id:'two',job_id:'two',status:'partially_paid',total:90,amount_paid:20,currency:'USD',invoice_number:'PORTAL'},{id:'draft',status:'draft',total:50,amount_paid:0},{id:'paid',status:'paid',total:50,amount_paid:50}];
 const h=setup({invoices,attempts:[{status:'review_required'}]});await showAccountPayments({db:h.db,user:{id:'user'},container:h.container,invoices,jobs:[{id:'one',reference:'PUBLIC-RFQ'},{id:'two',reference:'PORTAL-RFQ'}]});const select=h.container.all().find(e=>e.tag==='select');assert.equal(select.children.length,2);assert.ok(select.children[0].textContent.includes('PUBLIC-RFQ'));assert.ok(select.children[1].textContent.includes('USD 70.00'));select.value='two';await select.onchange();assert.ok(h.container.all().some(e=>e.href?.endsWith('id=two')));assert.equal(h.calls.length,0);
});
test('return handler confirms through backend and removes provider parameters',async()=>{
 const h=setup();globalThis.location.search='?type=job&id=test&payment=paypal&token=ORDERTEST';globalThis.location.href+='&payment=paypal&token=ORDERTEST&PayerID=PRIVATE';await completePayPalReturn({db:h.db,container:h.container});assert.deepEqual(h.calls,[{action:'capture',order_id:'ORDERTEST'}]);assert.ok(h.container.all().some(e=>e.textContent.includes('Payment received.')));assert.equal(globalThis.replaced,'https://www.ersygloballogistics.com/myegl/order/?type=job&id=test');
});
