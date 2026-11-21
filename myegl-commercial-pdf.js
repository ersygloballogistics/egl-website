// ERSY GLOBAL shared quotation/invoice PDF renderer (approved design, Nov 2026).
// Used by the customer portal, the order page and the administrator pages.

// Bank transfer details shown on invoices. Update these when the company bank account is ready.
const BANK = {
 company: 'ERSY GLOBAL LOGISTICS',
 holder: 'ESTHER AMINU',
 bank: 'Dubai Islamic Bank (DIB)',
 iban: 'AE730240001523243259701',
 account: '001523243259701'
};
const COMPANY = {
 address: 'CWS-1V-1000834, 26th Floor, Amber Gem Tower, Ajman, United Arab Emirates',
 contact: 'sales@ersygloballogistics.com   |   +971 55 658 1004   |   www.ersygloballogistics.com'
};

async function loadLogo(){
 return new Promise(resolve=>{
  const img=new Image();
  img.onload=()=>{try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);resolve({data:c.toDataURL('image/png'),w:img.naturalWidth,h:img.naturalHeight})}catch{resolve(null)}};
  img.onerror=()=>resolve(null);
  img.src='/egl-mark.png';
 });
}

export async function renderCommercialPDF(kind,record,job,mode='download'){
 await new Promise((ok,fail)=>{if(window.jspdf)return ok();const s=document.createElement('script');s.src='/vendor/jspdf.umd.min.js';s.onload=ok;s.onerror=()=>fail(new Error('PDF library failed to load'));document.head.append(s)});
 const {jsPDF}=window.jspdf;
 const pdf=new jsPDF({unit:'mm',format:'a4'});
 const NAVY=[11,34,57],TEAL=[196,145,42],TEALDK=[138,98,18],MUTED=[91,111,127],LINE=[220,230,236],SOFT=[243,248,250],WHITE=[255,255,255];
 const isQuote=kind==='quotation';
 const isPaid=!isQuote&&(record.status==='paid'||(Number(record.total)>0&&Number(record.amount_paid||0)>=Number(record.total)));
 const currency=record.currency||job.currency||'AED';
 const total=Number(isQuote?job.quoted_total:record.total)||0;
 const money=v=>Number(v||0).toLocaleString('en-AE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const date=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})};
 const pretty=v=>String(v||'').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
 const L=14,R=196,W=R-L;
 const txt=(s,x,y,size=9.5,bold=false,color=NAVY,opt={})=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);pdf.text(Array.isArray(s)?s.map(String):String(s??''),x,y,opt)};
 const wrap=(s,w,size)=>{pdf.setFont('helvetica','normal');pdf.setFontSize(size);return pdf.splitTextToSize(String(s??''),w)};
 const fill=c=>pdf.setFillColor(...c), stroke=c=>pdf.setDrawColor(...c);
 const number=isQuote?(job.reference||'—'):(record.invoice_number||'—');
 const customer=record.customer_name||job.customer_name||record.customer_email||job.customer_email||'Customer';
 const email=record.customer_email||job.customer_email||'';
 const phone=job.request_details?.phone||'';
 const origin=job.origin||'Not specified',destination=job.destination||'Not specified';
 const logo=await loadLogo();
 let y=0;

 const pageTop=first=>{
  if(first){
   fill(NAVY);pdf.rect(0,0,210,3,'F');fill(TEAL);pdf.rect(0,0,67,3,'F');
   if(logo){const lh=20,lw=lh*logo.w/logo.h;pdf.addImage(logo.data,'PNG',L,9,lw,lh);const tx=L+lw+4;txt('ERSY ',tx,19,20,true,NAVY);txt('GLOBAL',tx+pdf.getTextWidth('ERSY '),19,20,true,TEALDK);txt('L O G I S T I C S',tx,25.5,7.5,true,NAVY)}else txt('ERSY GLOBAL',L,22,20,true,NAVY);
   txt(isQuote?'QUOTATION':isPaid?'PAID INVOICE':'INVOICE',R,24,27,true,NAVY,{align:'right'});
   txt(isQuote?'Prepared for your logistics request':isPaid?'Payment received. Thank you.':'Request for payment',R,31,8.5,false,MUTED,{align:'right'});
  }else{
   fill(NAVY);pdf.rect(0,0,210,3,'F');fill(TEAL);pdf.rect(0,0,67,3,'F');
   txt('ERSY GLOBAL LOGISTICS',L,12,8,true,NAVY);txt((isQuote?'Quotation ':isPaid?'Paid invoice ':'Invoice ')+number,R,12,8,false,MUTED,{align:'right'});
   stroke(LINE);pdf.line(L,15,R,15);
  }
 };
 const newPage=()=>{pdf.addPage();pageTop(false);y=24};
 const ensure=h=>{if(y+h>268)newPage()};
 const sectionTitle=s=>{ensure(16);txt(s.toUpperCase(),L,y,9,true,NAVY);fill(TEAL);pdf.rect(L,y+2,9,.7,'F');stroke(LINE);pdf.line(L+11,y+2.35,R,y+2.35);y+=9};
 const card=(x,top,w,h,title)=>{fill(SOFT);stroke(LINE);pdf.setLineWidth(.2);pdf.roundedRect(x,top,w,h,2.5,2.5,'FD');fill(TEAL);pdf.rect(x,top+4,1,h-8,'F');txt(title.toUpperCase(),x+5,top+7,7,true,TEALDK)};

 pageTop(true);
 // key facts strip
 y=40;
 const issued=isQuote?(job.quotation_sent_at||job.created_at):record.issued_at;
 const facts=isQuote
  ?[['Quotation no.',number],['Issue date',date(issued)],['Valid until',date(job.quotation_valid_until)],['Status',pretty(job.quote_status)||'—']]
  :[['Invoice no.',number],['Issue date',date(issued)],['Due date',date(record.due_date)],['Status',pretty(record.status)||'—']];
 fill(NAVY);pdf.roundedRect(L,y,W,16,2.5,2.5,'F');
 facts.forEach(([k,v],i)=>{const x=L+6+i*(W/4);txt(k.toUpperCase(),x,y+6,6,true,[127,227,227]);txt(String(v).slice(0,22),x,y+12,9.5,true,WHITE);if(i){stroke([43,74,102]);pdf.line(L+i*(W/4),y+3.5,L+i*(W/4),y+12.5)}});
 y+=16+7;

 // two info cards
 const cw=(W-5)/2,ch=isQuote?33:36;
 card(L,y,cw,ch,isQuote?'Prepared for':'Billed to');
 txt(pdf.splitTextToSize(String(customer),cw-10).slice(0,2),L+5,y+14,10,true);
 let cy=y+(String(customer).length>38?24:20);
 if(email&&email!==customer){txt(email,L+5,cy,8.5,false,MUTED);cy+=5}
 if(phone){txt(String(phone),L+5,cy,8.5,false,MUTED);cy+=5}
 const addr=record.customer_address||job.customer_address;if(addr)txt(wrap(addr,cw-10,8.5).slice(0,1),L+5,cy,8.5,false,MUTED);
 const x2=L+cw+5;
 card(x2,y,cw,ch,isQuote?'Request details':'Order reference');
 txt(pretty(job.service_type)||'Logistics services',x2+5,y+14,10,true);
 const kv=(k,v,yy)=>{txt(k,x2+5,yy,6.5,true,MUTED);txt(wrap(v,cw-30,8.8).slice(0,1),x2+24,yy,8.8,false,NAVY)};
 kv('ROUTE',origin+'  >  '+destination,y+21);
 kv('REFERENCE',job.reference||'—',y+26.5);
 if(!isQuote)kv('QUOTATION',(job.reference||'—')+(job.quote_status?' ('+String(job.quote_status).replace(/_/g,' ')+')':''),y+32);
 y+=ch+9;

 if(isQuote){
  sectionTitle('Scope of services included');
  const services=Array.isArray(job.included_services)&&job.included_services.length?job.included_services:['Services as agreed in your request'];
  const half=(W-4)/2;
  for(let i=0;i<services.length;i+=2){
   ensure(8);
   for(let k=0;k<2&&i+k<services.length;k++){
    const x=L+k*(half+4);fill(TEALDK);pdf.circle(x+2.3,y-1.1,2.1,'F');txt(String(i+k+1),x+2.3,y-.4,6,true,WHITE,{align:'center'});
    txt(wrap(services[i+k],half-8,9).slice(0,1),x+7,y,9);
   }
   y+=7.2;
  }
  y+=3;
  ensure(34);
  const bw=88,bx=R-bw;
  fill(SOFT);stroke(LINE);pdf.roundedRect(bx,y,bw,25,2.5,2.5,'FD');
  txt('QUOTATION TOTAL',bx+6,y+7,6.8,true,MUTED);txt(currency+' '+money(total),bx+6,y+17,18,true,NAVY);
  txt('Excludes duties, taxes and third-party charges unless stated.',bx+6,y+22,6.2,false,MUTED);
  txt('HOW TO ACCEPT',L,y+7,7,true,TEALDK);
  txt(wrap('Sign in to your MyEGL portal and choose Accept quotation. You can also request a revision or contact our team if you would like anything changed.',bx-L-8,8.5),L,y+13,8.5);
  y+=25+10;
  sectionTitle('Payment options');
  ensure(26);
  const pw=(W-8)/3;
  [['Card payment','Pay securely by debit or credit card using the payment link on your invoice.'],['PayPal','Pay with PayPal, or as a guest by card, using the link on your invoice.'],['Bank transfer','Bank details are issued with your official invoice.']].forEach(([t,d],i)=>{
   const x=L+i*(pw+4);fill(WHITE);stroke(LINE);pdf.roundedRect(x,y,pw,22,2.5,2.5,'FD');txt(t,x+4.5,y+7,9,true);txt(wrap(d,pw-9,7.6).slice(0,3),x+4.5,y+12,7.6,false,MUTED);
  });
  y+=22+10;
  sectionTitle('Terms and conditions');
  const terms=String(job.quotation_terms||'').split(/\r?\n/).map(v=>v.trim().replace(/^[•\-]\s*|^\d+[.)]\s*/,'')).filter(Boolean);
  if(job.quotation_valid_until&&!terms.some(v=>/valid until/i.test(v)))terms.push('This quotation is valid until '+date(job.quotation_valid_until)+'.');
  if(!terms.length)terms.push('Quotation subject to acceptance of the agreed scope and terms.');
  for(const t of terms){const lines=wrap(t,W-6,8);ensure(lines.length*4+2);fill(TEAL);pdf.circle(L+1.2,y-1,.7,'F');txt(lines,L+4.5,y,8);y+=lines.length*3.9+1.8}
 }else{
  sectionTitle('Charges');
  const rows=[];
  const candidate=record.line_items||job.line_items||job.request_details?.line_items;
  if(Array.isArray(candidate)&&candidate.length){
   for(const x of candidate){const qty=Number(x.quantity??x.qty??1),price=Number(x.unit_price??x.rate??0),amount=Number(x.amount??qty*price);if(Number.isFinite(amount)&&qty>0)rows.push({description:String(x.description||x.name||'Service'),amount})}
  }
  const subtotal=Number(record.subtotal??total);
  if(!rows.length)rows.push({description:pretty(job.service_type||'Logistics')+' services'+(job.reference?'  ('+job.reference+')':''),amount:subtotal});
  fill(NAVY);pdf.roundedRect(L,y,W,8,1.8,1.8,'F');txt('DESCRIPTION',L+5,y+5.3,6.8,true,WHITE);txt('AMOUNT ('+currency+')',R-5,y+5.3,6.8,true,WHITE,{align:'right'});y+=8;
  rows.forEach((row,i)=>{
   const lines=wrap(row.description,W-50,9).slice(0,3),h=Math.max(9,lines.length*4.5+4);ensure(h);
   if(i%2===0){fill(SOFT);pdf.rect(L,y,W,h,'F')}
   txt(lines,L+5,y+6,9);txt(money(row.amount),R-5,y+6,9,false,NAVY,{align:'right'});y+=h;
  });
  stroke(LINE);pdf.line(L,y,R,y);y+=7;
  const paid=Number(record.amount_paid||0),balance=Math.max(0,total-paid),tx=R-80;
  ensure(40);
  txt('Subtotal',tx,y,9,false,MUTED);txt(money(subtotal),R-5,y,9,false,NAVY,{align:'right'});y+=6;
  txt('Amount paid',tx,y,9,false,MUTED);txt(money(paid),R-5,y,9,false,NAVY,{align:'right'});y+=5;
  fill(isPaid?[21,128,61]:TEALDK);pdf.roundedRect(tx-4,y,84,12,2,2,'F');if(isPaid){txt('PAID IN FULL',tx,y+7.4,7.5,true,WHITE);txt(currency+' '+money(paid),R-4,y+8,13,true,WHITE,{align:'right'})}else{txt('BALANCE DUE',tx,y+7.4,7.5,true,WHITE);txt(currency+' '+money(balance),R-4,y+8,13,true,WHITE,{align:'right'})}y+=12+10;
  if(isPaid){
   ensure(30);fill([236,248,240]);stroke([170,215,185]);pdf.roundedRect(L,y,W,22,2.5,2.5,'FD');
   txt('Payment received. This invoice is paid in full.',L+5,y+8,10,true,[21,100,55]);
   {const MET={bank_transfer:'Bank transfer',card:'Card payment',paypal:'PayPal',cash:'Cash',other:'Other'};const parts=[];if(record.paid_at)parts.push('Received on '+date(record.paid_at));if(MET[record.payment_method])parts.push('by '+MET[record.payment_method]);const detail=(parts.join(' ')+(record.payment_reference?'. Reference: '+record.payment_reference:'')).trim();txt(detail?detail+'. Keep this document as your receipt for '+number+'.':'Thank you for your payment. Please keep this document as your receipt for '+number+'.',L+5,y+14,8.2,false,[21,100,55])}
   txt('Questions? Contact sales@ersygloballogistics.com.',L+5,y+18.5,8.2,false,[21,100,55]);y+=22+6;
  }else{
  sectionTitle('How to pay');
  ensure(40);
  const pw=(W-8)/3,bh=34;
  const boxes=[['Card payment',['Open your invoice in MyEGL','and choose Card payment.','Card details are entered on','a secure payment page.']],['PayPal',['Choose PayPal in MyEGL to pay','with your PayPal account or','as a guest by card.']],['Bank transfer',['Company: '+BANK.company,'Account holder: '+BANK.holder,'Bank: '+BANK.bank,'IBAN: '+BANK.iban,'Account no.: '+BANK.account]]];
  boxes.forEach(([t,lines],i)=>{
   const x=L+i*(pw+4);fill(WHITE);stroke(LINE);pdf.roundedRect(x,y,pw,bh,2.5,2.5,'FD');fill(TEAL);pdf.rect(x+1,y,pw-2,1.3,'F');
   txt(t,x+4,y+8,9,true);let yy=y+14;for(const ln of lines){txt(wrap(ln,pw-7,7)[0],x+4,yy,7,false,MUTED);yy+=4.4}
  });
  y+=bh+8;
  ensure(16);
  fill([255,248,230]);stroke([240,217,160]);pdf.roundedRect(L,y,W,13,2,2,'FD');
  txt('Please quote  '+number+'  as your payment reference.',L+5,y+5.5,8.6,true,[107,74,0]);
  txt((record.due_date?'Payment is due by '+date(record.due_date)+'. ':'Please refer to the agreed payment terms. ')+'Questions? Contact sales@ersygloballogistics.com.',L+5,y+10,7.6,false,[107,74,0]);
  y+=13+6;
  }
 }

 const pages=pdf.getNumberOfPages();
 for(let n=1;n<=pages;n++){
  pdf.setPage(n);stroke(LINE);pdf.setLineWidth(.2);pdf.line(L,283,R,283);
  txt(COMPANY.address,L,288,6.8,false,MUTED);txt(COMPANY.contact,L,292,6.8,false,MUTED);
  txt('Page '+n+' of '+pages,R,292,6.8,false,MUTED,{align:'right'});
 }
 if(mode==='preview')return pdf.output('bloburl');
 pdf.save('ERSY-GLOBAL-'+(isQuote?'Quotation-':isPaid?'Paid-Invoice-':'Invoice-')+String(number).replace(/[^a-zA-Z0-9-]/g,'')+'.pdf');
}
