import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const allowed = new Set(["https://ersygloballogistics.github.io","https://ersygloballogistics.com","https://www.ersygloballogistics.com","https://ersyglobal.com","https://www.ersyglobal.com"]);
const services = new Set(["freight","buy-for-me","shop-ship","procurement","warehousing","purchasing"]);
const json = (status:number,data:unknown,origin:string)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","access-control-allow-origin":allowed.has(origin)?origin:"https://ersygloballogistics.github.io","vary":"Origin","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type"}});
const hex = (buf:ArrayBuffer)=>Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
// A short-lived token proves that the browser that created this request is the one adding files to it.
async function uploadToken(jobId:string,secret:string){
 const expires=Date.now()+2*60*60*1000;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode("upload:"+jobId+":"+expires));
 return expires+"."+hex(sig);
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":allowed.has(origin)?origin:"https://ersygloballogistics.github.io","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type","vary":"Origin"}});
 if(req.method!=="POST")return json(405,{error:"Method not allowed"},origin);
 if(!allowed.has(origin))return json(403,{error:"Origin not allowed"},origin);
 if(!(req.headers.get("content-type")||"").includes("application/json"))return json(415,{error:"JSON required"},origin);
 try{
  const raw=await req.text();if(raw.length>18000)return json(413,{error:"Request too large"},origin);
  const input=JSON.parse(raw);
  const field=(k:string,max=500)=>typeof input[k]==="string"?input[k].trim().slice(0,max):"";
  if(field("website",200))return json(200,{ok:true},origin);
  const email=field("email",320).toLowerCase(), service=field("service",60);
  if(!services.has(service)||!field("firstName",40)||!field("lastName",80)||!field("phone",30)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(400,{error:"Please complete the required contact fields"},origin);
  const details=input.details;
  if(!details||typeof details!=="object"||Array.isArray(details))return json(400,{error:"Missing service details"},origin);
  const clean:Record<string,string>={};
  for(const [key,value] of Object.entries(details)){if(Object.keys(clean).length>=35)break;if(!/^[a-zA-Z][a-zA-Z0-9]{0,35}$/.test(key))continue;if(typeof value==="string")clean[key]=value.trim().slice(0,4000);}
  if(JSON.stringify(clean).length>11000)return json(413,{error:"Please shorten the request"},origin);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json(503,{error:"Service unavailable"},origin);
  const headers={"apikey":key,"Authorization":"Bearer "+key,"Content-Type":"application/json"};
  const client=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||req.headers.get("cf-connecting-ip")||"unknown";
  const salt=Deno.env.get("WEBSITE_INTAKE_SALT")||key;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(salt+":"+client));
  const hash=hex(digest);
  const limit=await fetch(url+"/rest/v1/rpc/check_website_intake_limit",{method:"POST",headers,body:JSON.stringify({p_client_hash:hash})});
  if(!limit.ok)return json(503,{error:"Please try again later"},origin);
  if(await limit.json()!==true)return json(429,{error:"Too many requests. Please try again later."},origin);
  const uuid=crypto.randomUUID(),reference="EGL-"+uuid.slice(0,12).toUpperCase();
  const record={zoho_record_id:"WEB-"+uuid,reference,customer_email:email,service_type:service,origin:clean.origin||null,destination:clean.destination||null,request_details:{contact_name:field("firstName",40)+" "+field("lastName",80),company:field("company",200),phone:field("phone",30),source:"ERSY GLOBAL website",...clean}};
  const result=await fetch(url+"/rest/v1/portal_jobs",{method:"POST",headers:{...headers,"Prefer":"return=representation"},body:JSON.stringify(record)});
  if(!result.ok){console.error("Website intake insert failed",result.status);return json(502,{error:"Unable to submit your request. Please try again."},origin);}
  const saved=await result.json().catch(()=>null);
  const jobId=Array.isArray(saved)&&typeof saved[0]?.id==="string"?saved[0].id:"";
  const token=jobId?await uploadToken(jobId,salt):"";
  // Notify ERSY GLOBAL after the quote has been saved. Email errors must not invalidate a successful submission.
  const resendKey=Deno.env.get("RESEND_API_KEY");
  if(resendKey){
   try{
    const lines=Object.entries(clean).map(([k,v])=>k+": "+v).join("\n");
    const message=["New ERSY GLOBAL quotation request","Reference: "+reference,"Service: "+service,"Customer: "+record.request_details.contact_name,"Email: "+email,"Phone: "+record.request_details.phone,"Company: "+record.request_details.company,"Origin: "+(record.origin||""),"Destination: "+(record.destination||""),"","Request details:",lines].join("\n");
    const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from:"ERSY GLOBAL Quotes <quotes@send.ersygloballogistics.com>",to:["sales@ersygloballogistics.com"],reply_to:email,subject:"New RFQ "+reference+" — "+service,text:message})});
    if(!sent.ok)console.error("Quotation notification failed",sent.status);
   }catch(_err){console.error("Quotation notification request failed");}
  }else console.error("RESEND_API_KEY is not configured");
  return json(201,{ok:true,reference,job_id:jobId,upload_token:token},origin);
 }catch(e){if(e instanceof SyntaxError)return json(400,{error:"Invalid JSON"},origin);console.error("Website intake error");return json(500,{error:"Unable to submit your request"},origin);}
});
