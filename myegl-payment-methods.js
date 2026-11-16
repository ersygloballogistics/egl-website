// Compact, keyboard-accessible payment method selector. No payment starts here.
const create=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e};
let sequence=0;
export function createPaymentMethods({container,renderCard,renderPayPal,renderBank,onBusy=()=>{},showHeading=true}){
 const group=create('div');group.className='egl-payment-methods';
 const groupId='egl-payment-'+(++sequence),heading=create('h3','Payment method');heading.id=groupId+'-heading';heading.className='egl-payment-heading';
 if(showHeading){group.setAttribute('aria-labelledby',heading.id);container.append(heading,group)}else{group.setAttribute('aria-label','Payment method');container.append(group)}
 const rows=[];let busy=false;
 const icons={
  card:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>',
  paypal:'<span class="egl-paypal-wordmark">PayPal</span>',
  bank:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3 8 9-5 9 5v2H3V8Zm2 11h14M3 21h18M6 10v7m6-7v7m6-7v7"/></svg>'
 };
 const setBusy=value=>{busy=value;for(const row of rows)row.button.disabled=value;onBusy(value)};
 for(const [id,label,hint,render] of [['card','Card payment','Debit / credit',renderCard],['paypal','PayPal','',renderPayPal],['bank','Bank transfer','Bank details',renderBank]]){
  const item=create('div');item.className='egl-payment-method';
  const button=create('button');button.type='button';button.className='egl-payment-toggle';button.id=groupId+'-'+id;button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',button.id+'-panel');
  const radio=create('span');radio.className='egl-payment-choice';radio.setAttribute('aria-hidden','true');
  const icon=create('span');icon.className='egl-payment-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=icons[id];
  const name=create('span',label);name.className='egl-payment-label';
  const meta=create('span',hint);meta.className='egl-payment-hint';meta.setAttribute('aria-hidden','true');
  const arrow=create('span','⌄');arrow.className='egl-payment-chevron';arrow.setAttribute('aria-hidden','true');button.append(radio,icon,name,meta,arrow);
  const panel=create('div');panel.className='egl-payment-panel';panel.id=button.id+'-panel';panel.hidden=true;panel.setAttribute('role','region');panel.setAttribute('aria-labelledby',button.id);
  const row={id,item,button,panel,loaded:false};rows.push(row);item.append(button,panel);group.append(item);
  button.onclick=async()=>{
   if(busy)return;
   const opening=panel.hidden;
   for(const other of rows){other.panel.hidden=true;other.button.setAttribute('aria-expanded','false');other.item.classList.remove('is-open')}
   if(!opening)return;
   panel.hidden=false;button.setAttribute('aria-expanded','true');item.classList.add('is-open');
   if(row.loaded)return;row.loaded=true;
   try{await render(panel,setBusy)}catch{panel.append(create('p','Unable to load this payment option. Please refresh or choose another method.'))}
  };
 }
 return {setBusy};
}
