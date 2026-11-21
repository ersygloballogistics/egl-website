import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { regular as regularFont, bold as boldFont } from "./quotation-fonts.ts";

// A quotation is generated from the saved request, never an uploaded client PDF.
export async function createQuotationAttachment(job, issueDate) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularFont);
  const bold = await pdf.embedFont(boldFont);
  const navy = rgb(10/255,29/255,67/255), gold = rgb(196/255,145/255,42/255), goldDark = rgb(176/255,125/255,18/255);
  let mark = null;
  try {
    const res = await fetch("https://www.ersygloballogistics.com/egl-mark.png");
    if (res.ok) mark = await pdf.embedPng(new Uint8Array(await res.arrayBuffer()));
  } catch (_) { mark = null; }
  const ink = rgb(.09,.13,.18), gray = rgb(.36,.41,.46), pale = rgb(.95,.96,.97);
  const width=595.28,height=841.89,left=42,right=553;
  // Standard PDF fonts support Latin characters. Normalize punctuation safely.
  const clean = value => String(value ?? "").normalize('NFKC').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2022/g,'-').replace(/\u2192/g,' to ').replace(/[^\x20-\x7e\xa0-\xff\n]/g,'?');
  const reference=clean(job.reference || 'Quotation');
  const stamp=new Date(issueDate+'T00:00:00Z');
  pdf.setTitle('ERSY GLOBAL quotation '+reference);pdf.setAuthor('ERSY GLOBAL');
  pdf.setCreationDate(stamp);pdf.setModificationDate(stamp);
  let page,y;
  const text=(value,x,top,size=10,font=regular,color=ink)=>page.drawText(clean(value),{x,y:height-top,size,font,color});
  function addPage(){
    page=pdf.addPage([width,height]);
    if (mark) {
      const mh = 54, mw = mh * mark.width / mark.height;
      page.drawImage(mark,{x:left,y:height-82,width:mw,height:mh});
      const tx = left + mw + 12;
      text('ERSY ',tx,56,25,bold,navy);
      text('GLOBAL',tx+bold.widthOfTextAtSize('ERSY ',25),56,25,bold,goldDark);
      text('L O G I S T I C S',tx,73,9,bold,navy);
    } else {
      text('ERSY GLOBAL',left,55,25,bold,navy);
      text('LOGISTICS & SUPPLY CHAIN SOLUTIONS',left,72,8,regular,ink);
    }
    page.drawLine({start:{x:left,y:height-88},end:{x:right,y:height-88},thickness:2,color:gold});
    text('QUOTATION',left,119,23,bold,navy);
    text(reference,left,139,10,bold,gray);
    y=165;
  }
  function ensure(h){if(y+h>775)addPage();}
  function wrapped(value,maxWidth,font,size){
    const result=[];
    for(const paragraph of clean(value).split('\n')){
      let line='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        const candidate=line?line+' '+word:word;
        if(font.widthOfTextAtSize(candidate,size)<=maxWidth){line=candidate;continue;}
        if(line)result.push(line);line='';
        if(font.widthOfTextAtSize(word,size)>maxWidth){
          let part='';for(const char of word){if(font.widthOfTextAtSize(part+char,size)>maxWidth){result.push(part);part=char;}else part+=char;}line=part;
        }else line=word;
      }
      result.push(line);
    }
    return result;
  }
  function paragraph(value,{size=10,font=regular,color=ink,indent=0,gap=8}={}){
    for(const line of wrapped(value,right-left-indent,font,size)){ensure(size+8);text(line,left+indent,y,size,font,color);y+=size+5;}y+=gap;
  }
  function heading(value){ensure(45);y+=7;paragraph(value,{size:13,font:bold,color:navy,gap:7});}
  addPage();
  const details=job.request_details||{};
  const name=job.customer_name||details.contact_name||details.name||details.customer_name;
  paragraph('Quotation date: '+issueDate+'    |    Valid until: '+job.quotation_valid_until,{size:9,color:gray});
  if(name)paragraph(name,{size:12,font:bold});
  paragraph(job.customer_email||'',{size:10});
  if(details.company)paragraph(details.company,{size:10});
  const serviceNames={'shop-ship':'Shop & Ship','buy-for-me':'Buy For Me','freight':'Freight Forwarding','procurement':'Procurement & Sourcing','warehousing':'Warehousing & Fulfillment'};
  paragraph('Service: '+(serviceNames[job.service_type]||String(job.service_type||'Logistics services').replaceAll('-',' ').replaceAll('_',' ')),{font:bold});
  if(job.origin||job.destination)paragraph('Route: '+(job.origin||'To be confirmed')+' to '+(job.destination||'To be confirmed'));
  if(job.estimated_transit_date)paragraph('Estimated transit / delivery date: '+job.estimated_transit_date,{size:9,color:gray});
  ensure(70);y+=4;
  page.drawRectangle({x:left,y:height-y-52,width:right-left,height:52,color:pale});
  text('TOTAL QUOTED AMOUNT',left+14,y+20,10,bold,navy);
  text((job.currency||'AED')+' '+Number(job.quoted_total).toFixed(2),left+14,y+42,19,bold,navy);y+=72;
  const services=Array.isArray(job.included_services)?job.included_services:String(job.included_services||'').split('\n').filter(Boolean);
  if(services.length){heading('Included services');for(const service of services)paragraph('- '+service,{indent:4,gap:3});}
  const terms=String(job.quotation_terms||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  heading('Terms & Conditions');
  for(const term of terms.length?terms:['Quotation subject to acceptance of the agreed scope and terms.'])paragraph(term,{size:9,gap:5});
  heading('View and approve your quotation');
  paragraph('Create an account or sign in to MyEGL using the email address on this quotation.',{size:9,gap:4});
  paragraph('www.ersygloballogistics.com/myegl/',{size:9,color:navy});
  for(const [i,p]of pdf.getPages().entries()){
    p.drawLine({start:{x:left,y:46},end:{x:right,y:46},thickness:.5,color:gray});
    p.drawText('ERSY GLOBAL  |  sales@ersygloballogistics.com',{x:left,y:31,size:8,font:regular,color:gray});
    p.drawText('Page '+(i+1)+' of '+pdf.getPageCount(),{x:right-60,y:31,size:8,font:regular,color:gray});
  }
  const bytes=await pdf.save();
  return {filename:'ERSY-GLOBAL-Quotation-'+reference.replace(/[^A-Za-z0-9-]/g,'')+'.pdf',content:await pdf.saveAsBase64(),bytes};
}
