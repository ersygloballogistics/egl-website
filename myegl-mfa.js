// MyEGL two-step verification (authenticator app, TOTP) using Supabase Auth MFA.
// Optional for everyone; recommended for the administrator account.
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);Object.assign(e,props);for(const k of kids)e.append(k);return e};
export function initMfa({supabase,onVerified}){
 // ---- Sign-in challenge panel ----
 const msg=el('p',{role:'status'});
 const code=el('input',{id:'mfaCode',type:'text',inputMode:'numeric',autocomplete:'one-time-code',maxLength:6,placeholder:'6-digit code'});
 const verify=el('button',{type:'button',textContent:'Verify and continue'});
 const out=el('button',{type:'button',className:'forgot-link',textContent:'Sign out'});
 const panel=el('section',{className:'panel hidden',id:'mfaPanel'},el('h2',{textContent:'Two-step verification'}),el('p',{className:'muted',textContent:'Open your authenticator app and enter the 6-digit code for ERSY GLOBAL MyEGL.'}),el('label',{htmlFor:'mfaCode',textContent:'Authentication code'}),code,verify,msg,out);
 const anchor=document.getElementById('dashboard')||document.querySelector('main');
 anchor.parentNode.insertBefore(panel,anchor);
 const say=(node,t,bad)=>{node.textContent=t;node.className=bad?'error':'success'};
 verify.onclick=async()=>{const c=code.value.replace(/\s/g,'');if(!/^\d{6}$/.test(c)){say(msg,'Enter the 6-digit code from your app.',true);return}
  verify.disabled=true;try{const {data:f,error:fe}=await supabase.auth.mfa.listFactors();const factor=f?.totp?.find(x=>x.status==='verified');if(fe||!factor){say(msg,'No authenticator is set up for this account.',true);return}
   const {error}=await supabase.auth.mfa.challengeAndVerify({factorId:factor.id,code:c});if(error){say(msg,'That code was not accepted. Check the time on your phone and try again.',true);return}
   code.value='';say(msg,'');await onVerified()}finally{verify.disabled=false}};
 out.onclick=async()=>{await supabase.auth.signOut();code.value='';say(msg,'');await onVerified()};
 // Returns true when the page must stop and ask for the code.
 async function gate(user){
  if(!user){panel.classList.add('hidden');return false}
  const {data,error}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if(!error&&data?.nextLevel==='aal2'&&data.currentLevel!=='aal2'){
   for(const id of ['auth','dashboard','adminPanel','profilePanel','registerPanel','forgotPanel','resetPanel'])document.getElementById(id)?.classList.add('hidden');
   panel.classList.remove('hidden');code.focus();return true}
  panel.classList.add('hidden');return false}
 // ---- Profile section: set up / turn off ----
 const box=el('div',{id:'mfaSetup'});const status=el('p',{role:'status'});
 async function render(){box.replaceChildren(el('h3',{textContent:'Two-step verification'}),el('p',{className:'muted',textContent:'Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) when you sign in.'}));
  const {data}=await supabase.auth.mfa.listFactors();const active=data?.totp?.find(x=>x.status==='verified');
  if(active){box.append(el('p',{className:'success',textContent:'Two-step verification is ON.'}));
   const off=el('button',{type:'button',className:'secondary',textContent:'Turn off two-step verification'});
   off.onclick=async()=>{if(!confirm('Turn off two-step verification for this account?'))return;const {error}=await supabase.auth.mfa.unenroll({factorId:active.id});say(status,error?'Could not turn it off: '+error.message:'Two-step verification is off.',!!error);await render()};box.append(off,status);return}
  const start=el('button',{type:'button',textContent:'Set up two-step verification'});
  start.onclick=async()=>{start.disabled=true;
   // remove any half-finished earlier attempt first
   for(const f of data?.all||[])if(f.status!=='verified')await supabase.auth.mfa.unenroll({factorId:f.id});
   const {data:en,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'MyEGL '+new Date().toISOString().slice(0,10)});
   if(error){say(status,'Could not start set-up: '+error.message,true);start.disabled=false;return}
   const qr=el('img',{src:en.totp.qr_code,alt:'QR code for your authenticator app',width:200,height:200});qr.style.cssText='display:block;margin:12px 0;background:#fff;padding:8px;border:1px solid #cbdde3;border-radius:8px';
   const secret=el('p',{className:'muted',textContent:'Cannot scan? Enter this key manually: '+en.totp.secret});
   const c=el('input',{type:'text',inputMode:'numeric',autocomplete:'one-time-code',maxLength:6,placeholder:'6-digit code'});
   const confirm=el('button',{type:'button',textContent:'Confirm and turn on'});
   confirm.onclick=async()=>{const v=c.value.replace(/\s/g,'');if(!/^\d{6}$/.test(v)){say(status,'Enter the 6-digit code shown in your app.',true);return}
    const {error:e2}=await supabase.auth.mfa.challengeAndVerify({factorId:en.id,code:v});if(e2){say(status,'That code was not accepted. Try the next code.',true);return}
    say(status,'Two-step verification is now ON. You will be asked for a code at your next sign-in.');await render()};
   box.replaceChildren(el('h3',{textContent:'Scan with your authenticator app'}),el('p',{className:'muted',textContent:'1. Open the app and add an account by scanning this code. 2. Type the 6-digit code it shows.'}),qr,secret,c,confirm,status)};
  box.append(start,status)}
 const profile=document.getElementById('profilePanel');
 if(profile){const back=document.getElementById('closeProfile');profile.insertBefore(box,back||null)}
 return {gate,renderSetup:render};
}
