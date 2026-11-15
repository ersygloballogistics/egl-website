// ERSY GLOBAL shared quotation/invoice PDF renderer. Keep both portals in sync.
export async function renderCommercialPDF(kind,record,job,mode='download'){
 const {jsPDF}=await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm');
 const pdf=new jsPDF({unit:'mm',format:'a4'}), navy=[10,29,67],gold=[227,166,43],ink=[22,28,37],gray=[98,105,116],light=[241,243,246];
 const isQuote=kind==='quotation', currency=record.currency||job.currency||'AED', total=Number(isQuote?job.quoted_total:record.total)||0;
 const money=v=>Number(v||0).toLocaleString('en-AE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const date=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})};
 const txt=(s,x,y,size=10,bold=false,color=ink,opt={})=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);pdf.text(String(s??''),x,y,opt)};
 const hr=(y)=>{pdf.setDrawColor(182,187,193);pdf.setLineWidth(.3);pdf.line(14,y,196,y)};
 const number=isQuote?(job.reference||'—'):(record.invoice_number||'—');
 // Text-only wordmark matches the approved reference; no additional flyer-style imagery.
 txt('ERSY GLOBAL',20,23,25,true,navy);txt('LOGISTICS & SUPPLY CHAIN SOLUTIONS',20,30,8.7,false,ink);
 pdf.setDrawColor(...gray);pdf.line(116,12,116,36);
 txt(isQuote?'Quotation No.:':'Invoice No.:',124,18,9,true,ink);
 txt(number,155,18,9,false,ink);
 txt(isQuote?'Date:':'Invoice Date:',124,25,9,true,ink);
 txt(date(isQuote?(job.quotation_sent_at||job.created_at):record.issued_at),155,25,9,false,ink);
 txt(isQuote?'Valid Until:':'Due Date:',124,32,9,true,ink);
 txt(date(isQuote?job.quotation_valid_until:record.due_date),155,32,9,false,ink);
 pdf.setDrawColor(...gold);pdf.setLineWidth(.7);pdf.line(14,43,196,43);
 txt(isQuote?'QUOTATION':'INVOICE',14,61,26,true,navy);
 txt(isQuote?'To:':'Bill To:',15,76,11,true,navy);
 const customer=record.customer_name||job.customer_name||record.customer_email||job.customer_email||'Customer';
 txt(pdf.splitTextToSize(String(customer),175).slice(0,2),15,85,11,true,ink);
 if(record.customer_address||job.customer_address)txt(pdf.splitTextToSize(record.customer_address||job.customer_address,175).slice(0,2),15,96,9,false,ink);
 hr(99);
 const rows=[];
 const candidate=record.line_items||job.line_items||job.request_details?.line_items;
 if(Array.isArray(candidate)&&candidate.length){
  for(const x of candidate){const qty=Number(x.quantity??x.qty??1),price=Number(x.unit_price??x.rate??0),amount=Number(x.amount??qty*price);if(Number.isFinite(amount)&&qty>0)rows.push({description:String(x.description||x.name||'Service'),qty,price,amount})}
 }
 // Do not invent a breakdown from the example image; use one real total if no line items exist.
 if(!rows.length)rows.push({description:String(job.service_type||'Logistics services').replace(/_/g,' ')+' services',qty:1,price:isQuote?total:Number(record.subtotal??total),amount:isQuote?total:Number(record.subtotal??total)});
 let y=105;
 pdf.setFillColor(226,229,233);pdf.rect(14,y,182,11,'F');
 txt('No.',19,y+7,9,true);txt('Description',32,y+7,9,true);txt('Qty',107,y+7,9,true);txt('Unit Price ('+currency+')',149,y+7,8.2,true,ink,{align:'right'});txt('Amount ('+currency+')',192,y+7,8.2,true,ink,{align:'right'});
 y+=11;
 for(const [i,row] of rows.entries()){
  const lines=pdf.splitTextToSize(row.description,70).slice(0,3);const h=Math.max(11,lines.length*5+4);
  if(y+h>188){txt('Additional items are available in the order details.',19,y+6,8,false,gray);break}
  txt(i+1,20,y+7,9);txt(lines,32,y+7,9);txt(row.qty,109,y+7,9,false,ink,{align:'center'});
  txt(money(row.price),149,y+7,9,false,ink,{align:'right'});txt(money(row.amount),192,y+7,9,false,ink,{align:'right'});
  pdf.setDrawColor(223,226,230);pdf.line(14,y+h,196,y+h);y+=h;
 }
 y=Math.max(y+10,143);
 txt('Subtotal ('+currency+')',115,y,10,true,ink,{align:'right'});txt(money(isQuote?total:(record.subtotal??total)),192,y,10,true,ink,{align:'right'});
 pdf.setFillColor(255,242,212);pdf.roundedRect(76,y+7,120,13,1,1,'F');
 txt(isQuote?'Total Quoted Amount ('+currency+')':'Total Amount Payable ('+currency+')',81,y+16,10,true,ink);
 txt(money(total),192,y+16,13,true,navy,{align:'right'});
 let bottom=Math.max(179,y+31);
 if(isQuote){
  txt('Terms & Conditions',15,bottom,12,true,navy);bottom+=9;
  const terms=String(job.quotation_terms||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  if(job.quotation_valid_until&&!terms.some(v=>/valid until/i.test(v)))terms.push('This quotation is valid until '+date(job.quotation_valid_until)+'.');
  if(!terms.length)terms.push('Quotation subject to acceptance of the agreed scope and terms.');
  for(const t of terms){const lines=pdf.splitTextToSize(t.replace(/^[•\-\d.)\s]+/,''),168);if(bottom+lines.length*5>269)break;txt('•',17,bottom,9);txt(lines,23,bottom,9);bottom+=lines.length*5+3}
 }else{
  txt('Payment Details',15,bottom,12,true,navy);txt('Other Payment Options',113,bottom,12,true,navy);
  pdf.setDrawColor(...gray);pdf.line(106,bottom-5,106,bottom+39);
  bottom+=9;txt('Bank Transfer',15,bottom,10,true,navy);bottom+=7;
  for(const line of ['Bank: Dubai Islamic Bank (DIB)','Account Holder: ESTHER AMINU','IBAN: AE730240001523243259701','Account Number: 001523243259701']){txt(line,15,bottom,8.8);bottom+=6}
  txt('Stripe – Payment link available on request',113,bottom-27,8.6);txt('PayPal – Payment link available on request',113,bottom-15,8.6);
  bottom+=7;hr(bottom);bottom+=10;txt('Payment Terms',15,bottom,11,true,navy);bottom+=8;
  const terms=record.due_date?'Payment due by '+date(record.due_date)+'.':'Please refer to the agreed payment terms.';
  txt('• '+terms,17,bottom,9);
  txt('Please include '+number+' as the payment reference.',15,Math.min(bottom+13,276),8,false,gray);
 }
 if(mode==='preview')return pdf.output('bloburl');
 pdf.save('ERSY-GLOBAL-'+(isQuote?'Quotation-':'Invoice-')+String(number).replace(/[^a-zA-Z0-9-]/g,'')+'.pdf');
}
