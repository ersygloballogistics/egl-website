import {test} from 'node:test';
import assert from 'node:assert/strict';
import {showPayPal,completePayPalReturn} from '../myegl-paypal.js';
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.attrs={}}
 append(...c){this.children.push(...c)}prepend(...c){this.children.unshift(...c)}setAttribute(k,v){this.attrs[k]=v}
 all(){return [this,...this.children.flatMap(c=>c.all())]}
}
function setup({attempts=[],invoices=[{id:'invoice',invoice_number:'INV-TEST',status:'issued',total:50,amount_paid:0,currency:'AED'}],result,invokeError}={}){
 globalThis.document={createElement:tag=>new Element(tag)};
 globalThis.location={search:'',href:'https://www.ersygloballogistics.com/myegl/order/?type=job&id=test',assign:url=>{globalThis.assigned=url},reload:()=>{}};
 globalThis.history={replaceState:(state,title,url)=>{globalThis.replaced=url.href}};
 const calls=[];
 const db={from(table){const value={data:table==='myegl_paypal_orders'?attempts:invoices,error:null};const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,then:(a,b)=>Promise.resolve(value).then(a,b)};return q},functions:{invoke:async(name,{body})=>{calls.push(body);if(invokeError)return{error:invokeError};return {data:body.action==='quote'?{invoice_id:'invoice',invoice_number:'INV-TEST',invoice_amount:'50.00',invoice_currency:'AED',amount:'13.61',currency:'USD',aed_per_usd:'3.6725'}:result}}}};
 const container=new Element('div');return {db,calls,container,run:()=>showPayPal({db,job:{id:'job',payment_status:'pending'},user:{id:'user'},container})};
}
test('mobile checkout presents both currencies before a separate Continue button',async()=>{
 const h=setup({result:{approval_url:'https://www.paypal.com/checkoutnow?token=FIXTURE'}});await h.run();const texts=h.container.all().map(e=>e.textContent);assert.ok(texts.some(t=>t.includes('Balance AED 50.00')));assert.ok(texts.includes('Pay with PayPal: USD 13.61'));assert.ok(texts.some(t=>t.includes('3.6725')));const button=h.container.all().find(e=>e.tag==='button');assert.equal(button.textContent,'Continue to PayPal');await button.onclick();assert.equal(globalThis.assigned,'https://www.paypal.com/checkoutnow?token=FIXTURE');assert.deepEqual(h.calls[1],{action:'create',invoice_id:'invoice'});
});
test('unissued invoices do not display a payment action',async()=>{
 const h=setup({invoices:[]});await h.run();assert.ok(h.container.all().some(e=>e.textContent.includes('issues your invoice')));assert.equal(h.container.all().filter(e=>e.tag==='button').length,0);assert.equal(h.calls.length,0);
});
test('a reviewed payment blocks another checkout even when invoice is paid',async()=>{
 const h=setup({attempts:[{status:'review_required'}],invoices:[]});await h.run();assert.ok(h.container.all().some(e=>e.textContent.includes('reviewing this payment')));assert.equal(h.container.all().filter(e=>e.tag==='button').length,0);assert.equal(h.calls.length,0);
});
test('configuration failure gives a clear message with no checkout button',async()=>{
 const h=setup({invokeError:{context:{json:async()=>({error:'PayPal checkout is being set up.'})}}});await h.run();assert.ok(h.container.all().some(e=>e.textContent==='PayPal checkout is being set up.'));assert.equal(h.container.all().filter(e=>e.tag==='button').length,0);
});
test('return handler confirms through backend and removes provider parameters',async()=>{
 const h=setup({result:{status:'completed',capture_id:'CAPTURE-TEST'}});globalThis.location.search='?type=job&id=test&payment=paypal&token=ORDERTEST';globalThis.location.href+='&payment=paypal&token=ORDERTEST&PayerID=PRIVATE';await completePayPalReturn({db:h.db,container:h.container});assert.deepEqual(h.calls,[{action:'capture',order_id:'ORDERTEST'}]);assert.ok(h.container.all().some(e=>e.textContent.includes('Payment received.')));assert.equal(globalThis.replaced,'https://www.ersygloballogistics.com/myegl/order/?type=job&id=test');
});
