import { feedbackMessage, feedbackTextError } from '/edit/shared/feedback.mjs';
const form=document.querySelector('#feedback-form'), status=document.querySelector('#feedback-status'), signIn=document.querySelector('#feedback-sign-in');
const context=document.querySelector('#feedback-context'), category=document.querySelector('#feedback-category'), message=document.querySelector('#feedback-message'), confirmed=document.querySelector('#feedback-confirmed'), submit=document.querySelector('#feedback-submit'), preview=document.querySelector('#feedback-preview');
let csrf='',locked=false,busy=false;
const requestId=crypto.randomUUID();
async function json(path,options={}) {
  const response=await fetch('/api/editor/'+path,{credentials:'same-origin',cache:'no-store',redirect:'error',...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.error?.message || 'Feedback could not be confirmed. Do not resend it.');
  return data;
}
function update({changed=false}={}) {
  if(changed)confirmed.checked=false;
  preview.textContent=feedbackMessage(category.value,context.value,message.value);
  const problem=feedbackTextError(message.value);
  document.querySelector('#feedback-message-help').textContent=problem || 'Ready to review. Confirm the exact message below before posting.';
  submit.disabled=locked||busy||!csrf||!confirmed.checked||Boolean(problem);
}
for(const field of [message,category,context])field.addEventListener('input',()=>update({changed:true}));
confirmed.addEventListener('change',()=>update());
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(locked||busy||!confirmed.checked)return;
  const error=feedbackTextError(message.value);if(error){status.textContent=error;return;}
  const payload={requestId,category:category.value,context:context.value,message:message.value.trim(),confirmed:true};
  busy=true;form.querySelectorAll('input,textarea,select').forEach(field=>field.disabled=true);update();
  try {
    // Recheck sign-in without changing or posting any account information.
    const session=await json('session');
    if(!session.user||session.csrfToken!==csrf){csrf='';confirmed.checked=false;status.textContent='Sign-in changed. Reload, review the text and confirm again. Nothing was posted.';return;}
    // Freeze the exact reviewed content and one request ID. Never retry this POST.
    locked=true;
    const result=await json('feedback',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(payload)});
    if(result.posted!==true)throw Error('Discord delivery was not confirmed. Do not resend it.');
    status.textContent='Posted to the project’s Discord feedback channel. Thank you.';
  } catch(error) { status.textContent=locked?`Delivery was not confirmed. ${error.message} Do not resend this report.`:error.message; }
  finally {busy=false;if(!locked)form.querySelectorAll('input,textarea,select').forEach(field=>field.disabled=false);update();}
});
async function start(){
  try {
    if(!(await json('feedback')).enabled){status.textContent='Website feedback is unavailable on this deployment. Nothing has been sent.';return;}
    const paths=await (await fetch('/data/feedback-contexts.json',{cache:'no-store'})).json();
    let saved='/';try{saved=sessionStorage.getItem('pvme-feedback-context')||'/';}catch{}
    const requested=new URLSearchParams(location.search).get('context')||saved;
    const current=paths.includes(requested)?requested:'/';
    try{sessionStorage.setItem('pvme-feedback-context',current);}catch{}
    for(const path of [...new Set([current,'/'])]){const option=document.createElement('option');option.value=path;option.textContent=path==='/'?'Whole website (/)':path;context.append(option);}
    const session=await json('session');
    if(!session.user||!session.csrfToken){status.textContent='Sign in first. Your identity is used for spam prevention and will not be posted.';signIn.hidden=false;return;}
    csrf=session.csrfToken;status.textContent='Signed in. Review the message below before posting.';form.hidden=false;update();
  }catch{status.textContent='Website feedback could not be loaded. Nothing has been sent.';}
}
start();
