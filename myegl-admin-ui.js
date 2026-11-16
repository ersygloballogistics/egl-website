// MyEGL administrator layout: tabs, status pills, quick filters. Presentation only; never touches data or permissions.
(()=>{
 const $=id=>document.getElementById(id);
 const panel=$('adminPanel');if(!panel)return;
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
 const reqSec=$('adminRfqSection'),custSec=$('adminCustomerSection'),stats=$('adminStats');
 if(!reqSec||!custSec||!stats)return;
 const pillClass=s=>{s=String(s).toLowerCase();return /archiv/.test(s)?'s-archived':/revision/.test(s)?'s-revision':/declin|reject/.test(s)?'s-declined':/approv/.test(s)?'s-approved':/pending/.test(s)?'s-pending':/draft/.test(s)?'s-draft':'s-submitted'};
 const needsAction=s=>/draft|submitted|revision/i.test(s);
 let tab='requests',chip='all';
 // Tabs
 const tabs=make('div','egl-tabs');tabs.setAttribute('role','tablist');
 const tabBtn=(id,label)=>{const b=make('button','egl-tab',label);b.type='button';b.setAttribute('role','tab');b.dataset.tab=id;b.onclick=()=>setTab(id);const c=make('span','egl-count','–');b.append(c);tabs.append(b);return c};
 const reqCount=tabBtn('requests','Requests'),regCount=tabBtn('registrations','Registrations');
 panel.insertBefore(tabs,custSec.compareDocumentPosition(reqSec)&Node.DOCUMENT_POSITION_FOLLOWING?custSec:reqSec);
 // Filter chips + table header
 const chips=make('div','egl-chips');
 const chipDefs=[['all','All'],['action','Needs my action'],['sent','Quotation sent'],['approved','Approved'],['closed','Declined / archived']];
 for(const [id,label] of chipDefs){const b=make('button','egl-chip',label);b.type='button';b.dataset.chip=id;b.setAttribute('aria-pressed',id==='all');b.onclick=()=>{chip=id;for(const x of chips.children)x.setAttribute('aria-pressed',x.dataset.chip===id);applyChip()};chips.append(b)}
 const head=make('div','egl-thead');for(const t of ['Reference','Service','Customer','Route','Status','Submitted'])head.append(make('span','',t));
 const rfqs=$('adminRfqs');reqSec.insertBefore(chips,rfqs);reqSec.insertBefore(head,rfqs);
 const empty=make('div','egl-empty','No requests match this filter on this page.');empty.hidden=true;reqSec.insertBefore(empty,rfqs.nextSibling);
 function setTab(id){tab=id;document.body.classList.add('egl-admin');
  reqSec.classList.toggle('egl-tab-hidden',id!=='requests');
  custSec.classList.toggle('egl-tab-active',id==='registrations');custSec.open=true;
  custSec.classList.toggle('egl-tab-hidden',id!=='registrations');
  for(const b of tabs.children)b.setAttribute('aria-selected',b.dataset.tab===id)}
 function applyChip(){let shown=0;for(const d of rfqs.querySelectorAll(':scope>details.admin-job-detail')){const s=d.dataset.status||'';const ok=chip==='all'||(chip==='action'&&needsAction(s))||(chip==='sent'&&/pending/i.test(s))||(chip==='approved'&&/approv/i.test(s))||(chip==='closed'&&/declin|reject|archiv/i.test(s)||d.dataset.archived==='1'&&chip==='closed');d.hidden=!ok;if(ok)shown++}empty.hidden=shown>0||!rfqs.querySelector('details')}
 // Rebuild each request summary as a table row (original text is parsed, body untouched)
 function enhanceRows(){for(const d of rfqs.querySelectorAll(':scope>details.admin-job-detail:not([data-egl])')){
  const sum=d.querySelector(':scope>summary');if(!sum)continue;d.dataset.egl='1';
  const parts=sum.textContent.split(' · ');const ref=parts[0]||'',service=parts[1]||'',status=parts.slice(2).join(' · ')||'submitted';
  const body=d.querySelector('.job');const lines=body?[...body.querySelectorAll(':scope>p')].map(p=>p.textContent):[];
  const customer=lines[0]||'',route=lines[1]||'',meta=lines[2]||'';
  const submitted=(meta.match(/Submitted:\s*([^·]+)/)||[])[1]||'';const archived=/Archived/.test(meta);
  const linked=lines.find(l=>/^Quotation \/ order:/.test(l));
  d.dataset.status=status;d.dataset.archived=archived?'1':'0';
  sum.className='egl-row';sum.replaceChildren();
  const c1=make('span','egl-cell');c1.append(make('span','egl-ref',ref));if(linked)c1.append(make('span','egl-sub',linked.replace('Quotation / order: ','Order ')));
  const c2=make('span','egl-cell',service.replace(/-/g,' ').replace(/\b\w/g,m=>m.toUpperCase()));
  const c3=make('span','egl-cell c-customer',customer);
  const c4=make('span','egl-cell c-route',route);
  const c5=make('span','egl-cell');const pill=make('span','egl-pill '+pillClass(archived?'archived':status),archived?'archived':status);c5.append(pill);
  let dateText='';if(submitted){const t=new Date(submitted.trim());dateText=Number.isNaN(t.getTime())?submitted.trim().split(',')[0]:t.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
  const c6=make('span','egl-cell egl-date',dateText);
  sum.append(c1,c2,c3,c4,c5,c6)}
  applyChip()}
 new MutationObserver(enhanceRows).observe(rfqs,{childList:true});
 // KPI cards: pending approvals highlight and switch tab instead of leaving the page
 function enhanceStats(){const cards=[...stats.querySelectorAll('.admin-stat')];if(cards.length<4)return;
  const num=i=>Number((cards[i].querySelector('strong')||{}).textContent);
  const pend=num(1);cards[1].classList.toggle('egl-attention',pend>0);
  regCount.textContent=Number.isFinite(pend)?String(pend)+' pending':'–';regCount.classList.toggle('warn',pend>0);
  const all=num(2);reqCount.textContent=Number.isFinite(all)?String(all):'–';
  cards[0].onclick=cards[1].onclick=()=>{setTab('registrations');tabs.scrollIntoView({behavior:'smooth',block:'start'})};
  cards[2].onclick=()=>{setTab('requests');tabs.scrollIntoView({behavior:'smooth',block:'start'})};
  cards[3].onclick=()=>{location.href='/myegl/customers/'}}
 new MutationObserver(enhanceStats).observe(stats,{childList:true});
 // Apply layout only while the admin panel is visible
 const sync=()=>{const on=!panel.classList.contains('hidden');document.body.classList.toggle('egl-admin',on);if(on){setTab(tab);enhanceRows();enhanceStats()}};
 new MutationObserver(sync).observe(panel,{attributes:true,attributeFilter:['class']});sync();
})();
