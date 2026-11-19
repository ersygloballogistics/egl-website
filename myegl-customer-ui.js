// MyEGL customer layout: turns the plain order text into cards with status labels and a progress bar.
// It only rearranges elements that the portal already renders; every button keeps its original behaviour.
(()=>{
 const jobsBox=document.getElementById('jobs'),rfqBox=document.getElementById('myRfqs'),area=document.getElementById('rfqArea');
 if(!jobsBox||!rfqBox||!area)return;
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
 const nice=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
 const shipLabel={not_started:'Not started yet',preparing:'Preparing',booked:'Booked',in_transit:'In transit',customs_clearance:'Customs clearance',out_for_delivery:'Out for delivery',delivered:'Delivered'};
 const quoteLabel={pending:['Awaiting your approval','s-pending'],approved:['Quotation approved','s-approved'],declined:['Declined','s-declined'],revision_requested:['Revision requested','s-revision'],expired:['Expired','s-declined'],draft:['Being prepared','s-info'],not_quoted:['Being prepared','s-info']};
 const field=(card,re)=>{for(const p of card.querySelectorAll(':scope>p')){const m=p.textContent.match(re);if(m){p.dataset.eglUsed='1';return m}}return null};
 function stepper(quote,pay,ship){
  const names=['Quotation','Approved','Payment','Shipping','Delivered'];let active=0;
  if(quote==='approved'){active=pay!=='paid'?2:(ship==='delivered'?5:3)}
  else if(ship==='delivered'&&pay==='paid')active=5;
  const ol=make('ol','egl-steps');ol.setAttribute('aria-label','Order progress');
  names.forEach((n,i)=>{const li=make('li',i<active?'done':i===active?'current':'',n);if(i===active)li.setAttribute('aria-current','step');ol.append(li)});return ol}
 function buttons(card){for(const b of card.querySelectorAll('button')){const t=b.textContent.trim();
  if(/^Accept quotation/.test(t))b.classList.add('egl-primary');
  else if(/^Decline quotation/.test(t))b.classList.add('egl-decline');
  else if(/^Request revision/.test(t))b.classList.add('egl-link');
  else if(/^Download quotation/.test(t))b.classList.add('egl-pdf');
  else if(/^Download paid invoice/.test(t))b.classList.add('egl-receipt');
  else if(/^Send request/.test(t))b.classList.add('egl-primary')}}
 function enhanceJob(card){
  if(card.dataset.egl)return;card.dataset.egl='1';
  const ref=card.querySelector('h3 a');if(!ref)return;
  const svc=field(card,/^Service:\s*(.*?)\s*\|\s*(.*?)\s*→\s*(.*)$/);
  const total=field(card,/^Quotation:\s*(.*)$/);
  const st=field(card,/^Quote status:\s*(\S+)\s*\|\s*Payment:\s*(\S+)/);
  const sh=field(card,/^Shipment:\s*(.*?)(?:\s*\|\s*Tracking:\s*(.*))?$/);
  const quote=st?st[1]:'',pay=st?st[2]:'',ship=sh?String(sh[1]).trim().toLowerCase().replace(/ /g,'_'):'not_started';
  const [label,cls]=quoteLabel[quote]||[nice(quote),'s-info'];
  const head=make('div','egl-card-head');const left=make('div');ref.removeAttribute('style');left.append(ref);
  if(svc)left.append(make('div','egl-service',nice(svc[1])));
  const pill=make('span','egl-pill '+cls,label);head.append(left,pill);
  const facts=make('div','egl-facts');
  const fact=(k,v)=>{const d=make('div','egl-fact');const b=make('b','');if(v&&v.nodeType)b.append(v);else b.textContent=v;d.append(make('small','',k),b);facts.append(d)};
  if(svc){const o=svc[2]&&svc[2]!=='—'?svc[2]:'Origin to be confirmed',d=svc[3]&&svc[3]!=='—'?svc[3]:'Destination to be confirmed';fact('Route',o+' → '+d)}
  if(total)fact('Quotation',total[1]==='Not issued'?'Not issued yet':total[1]);
  {const shipText=(shipLabel[ship]||nice(ship));if(sh&&sh[2]&&card.dataset.trackUrl){const wrap=document.createElement('span');wrap.append(shipText+' · Tracking ');const a=make('a','egl-track',sh[2].trim()+' ↗');a.href=card.dataset.trackUrl;a.target='_blank';a.rel='noopener noreferrer';a.title='Track with '+(card.dataset.trackCarrier||'the carrier');wrap.append(a);fact('Shipment',wrap)}else fact('Shipment',shipText+(sh&&sh[2]?' · Tracking '+sh[2]:''))}
  if(pay&&pay!=='not_requested')fact('Payment',nice(pay));
  const body=make('div','egl-card-body');
  const keep=[...card.childNodes].filter(n=>!(n.nodeType===1&&(n.tagName==='H3'||n.dataset.eglUsed)));
  for(const n of keep)body.append(n);buttons(body);
  for(const d of body.querySelectorAll('details')){const sm=d.querySelector('summary');if(sm&&/^Quotation details/.test(sm.textContent))d.open=(quote==='pending')}
  for(const l of body.querySelectorAll('a[href*="/myegl/order/"]'))l.classList.add('egl-paylink');
  card.replaceChildren(head,facts);
  if(['pending','approved','revision_requested'].includes(quote)||ship!=='not_started')card.append(stepper(quote,pay,ship));
  card.append(body);card.classList.add('egl-job-card');
  if(card.querySelector('button.egl-primary')&&quote==='pending')card.dataset.needsAction='1'}
 function enhanceRfq(card){
  if(card.dataset.egl)return;card.dataset.egl='1';
  const a=card.querySelector(':scope>a');if(!a)return;
  const parts=a.textContent.split(' · ');const s=field(card,/^Status:\s*(\S+)\s*\|\s*Submitted:\s*(.*)$/);const r=field(card,/^(.*?)\s*→\s*(.*)$/);
  const head=make('div','egl-card-head');const left=make('div');a.textContent=parts[0];a.removeAttribute('style');left.append(a,make('div','egl-service',nice(parts.slice(1).join(' · '))));
  const map={submitted:['Request received','s-info'],under_review:['Under review','s-pending'],quoted:['Quotation ready','s-approved'],closed:['Closed','s-declined']};
  const [label,cls]=map[s&&s[1]]||[nice(s&&s[1]),'s-info'];head.append(left,make('span','egl-pill '+cls,label));
  const facts=make('div','egl-facts');const fact=(k,v)=>{const d=make('div','egl-fact');d.append(make('small','',k),make('b','',v));facts.append(d)};
  if(r)fact('Route',r[1]+' → '+r[2]);if(s)fact('Submitted',s[2]);
  const body=make('div','egl-card-body');for(const n of [...card.childNodes].filter(n=>!(n.nodeType===1&&(n===a||n.dataset.eglUsed))))body.append(n);
  card.replaceChildren(head,facts,body);card.classList.add('egl-job-card')}
 function banner(){
  let b=document.getElementById('eglAttention');const cards=[...jobsBox.querySelectorAll('.job[data-needs-action="1"]')];
  if(!cards.length){if(b)b.remove();return}
  if(!b){b=make('div','egl-attention');b.id='eglAttention';area.insertBefore(b,area.firstChild)}
  b.replaceChildren();const t=make('div');t.append(make('strong','',cards.length===1?'1 quotation is waiting for your approval':cards.length+' quotations are waiting for your approval'),make('span','','Please review it and choose Accept, Decline or Request revision.'));
  const btn=make('button','','Review now');btn.type='button';btn.onclick=()=>cards[0].scrollIntoView({behavior:'smooth',block:'start'});b.append(t,btn)}
 function emptyNote(){const only=rfqBox.children.length===1&&rfqBox.firstElementChild.tagName==='P';rfqBox.hidden=only&&!!jobsBox.querySelector('.job,.egl-empty')}
 function help(){if(document.getElementById('eglHelp'))return;const a=make('a','egl-help','Need help? WhatsApp us');a.id='eglHelp';a.href='https://wa.me/971556581004?text='+encodeURIComponent('Hello ERSY GLOBAL, I need help with my MyEGL account.');a.target='_blank';a.rel='noopener noreferrer';document.body.append(a)}
 function run(){help();document.body.classList.toggle('egl-customer',!area.classList.contains('hidden'));
  for(const c of jobsBox.querySelectorAll(':scope>.job'))enhanceJob(c);
  for(const c of rfqBox.querySelectorAll(':scope>.job'))enhanceRfq(c);
  banner();emptyNote()}
 const mo=new MutationObserver(run);mo.observe(jobsBox,{childList:true});mo.observe(rfqBox,{childList:true});mo.observe(area,{attributes:true,attributeFilter:['class']});run();
})();
