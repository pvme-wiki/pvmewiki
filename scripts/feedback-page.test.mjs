import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { applyFeedbackPage } from './feedback-page.mjs';
import { feedbackMessage,feedbackTextError } from '../editor/shared/feedback.mjs';
import { feedbackContexts } from './feedback-contexts.mjs';
const root=new URL('..',import.meta.url).pathname;
function browser(fetchImpl,{query='?context=%2Fread%2Farch-glacor%2F'}={}){
 const nodes=new Map();
 function node(id){if(!nodes.has(id))nodes.set(id,{hidden:true,value:id==='#feedback-category'?'bug':'',checked:false,disabled:false,textContent:'',events:{},children:[],addEventListener(type,fn){this.events[type]=fn;},append(option){this.children.push(option);if(!this.value)this.value=option.value;},querySelectorAll(){return ['#feedback-context','#feedback-category','#feedback-message','#feedback-confirmed'].map(node);}});return nodes.get(id);}
 const storage=[];
 const context=vm.createContext({document:{querySelector:node,createElement:()=>({})},crypto:{randomUUID},fetch:fetchImpl,URLSearchParams,location:{search:query},sessionStorage:{getItem:()=>null,setItem:(key,value)=>storage.push([key,value])},feedbackMessage,feedbackTextError,ready:null});
 const code=fs.readFileSync(new URL('../src/feedback-page.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace(/start\(\);\s*$/,'ready=start();');vm.runInContext(code,context);
 return {node,storage,ready:context.ready};
}
const session={user:{id:'never-posted-private-user-id'},csrfToken:'fixture-csrf'};
test('disabled Preview feedback has no active form, sign-in request or external message',async()=>{
 const calls=[];const ui=browser(async url=>{calls.push(url);return Response.json({enabled:false});});await ui.ready;
 assert.deepEqual(calls,['/api/editor/feedback']);assert.equal(ui.node('#feedback-form').hidden,true);assert.match(ui.node('#feedback-status').textContent,/unavailable/);
});
test('the reviewed message is frozen before session recheck and posted once without identity or query data',async()=>{
 let release;const calls=[];let sessionCalls=0;let posted;
 const ui=browser(async(url,init={})=>{
  calls.push([url,init.method||'GET']);
  if(url==='/data/feedback-contexts.json')return Response.json([...feedbackContexts()]);
  if(url==='/api/editor/feedback'&&!init.method)return Response.json({enabled:true});
  if(url==='/api/editor/session'){
   if(++sessionCalls===2)await new Promise(resolve=>release=resolve);
   return Response.json(session);
  }
  posted=JSON.parse(init.body);return Response.json({posted:true});
 });await ui.ready;
 ui.node('#feedback-message').value='The navigation button needs more contrast.';ui.node('#feedback-message').events.input();
 ui.node('#feedback-confirmed').checked=true;ui.node('#feedback-confirmed').events.change();
 const exact=ui.node('#feedback-preview').textContent;
 const submitting=ui.node('#feedback-form').events.submit({preventDefault(){}});
 assert.equal(ui.node('#feedback-message').disabled,true);
 // Even a programmatic change during the await cannot alter the frozen payload.
 ui.node('#feedback-message').value='Different text that was not reviewed.';release();await submitting;
 assert.equal(feedbackMessage(posted.category,posted.context,posted.message),exact);
 assert.equal(posted.context,'/read/arch-glacor/');assert.equal(posted.confirmed,true);
 assert.ok(!JSON.stringify(posted).includes(session.user.id));assert.ok(!JSON.stringify(posted).includes(session.csrfToken));
 await ui.node('#feedback-form').events.submit({preventDefault(){}});
 assert.equal(calls.filter(([url,method])=>url==='/api/editor/feedback'&&method==='POST').length,1);
 assert.match(ui.node('#feedback-status').textContent,/^Posted to/);
 assert.deepEqual(ui.storage,[['pvme-feedback-context','/read/arch-glacor/']]);
});
test('unconfirmed failure stays locked and sign-in changes cannot dispatch',async()=>{
 for(const changedIdentity of [false,true]){
  let sessions=0,posts=0;
  const ui=browser(async(url,init={})=>{
   if(url==='/data/feedback-contexts.json')return Response.json(['/']);
   if(url==='/api/editor/feedback'&&!init.method)return Response.json({enabled:true});
   if(url==='/api/editor/session')return Response.json({...session,csrfToken:++sessions>1&&changedIdentity?'changed':session.csrfToken});
   posts++;return Response.json({error:{message:'Delivery is unconfirmed.'}},{status:502});
  },{query:'?context=%2Fedit%2F%23private-draft&contact=never-forward'});await ui.ready;
  ui.node('#feedback-message').value='The website search could be clearer.';ui.node('#feedback-message').events.input();
  assert.equal(ui.node('#feedback-submit').disabled,true);
  ui.node('#feedback-confirmed').checked=true;ui.node('#feedback-confirmed').events.change();
  await ui.node('#feedback-form').events.submit({preventDefault(){}});
  assert.equal(posts,changedIdentity?0:1);assert.equal(ui.node('#feedback-submit').disabled,true);
  if(!changedIdentity){await ui.node('#feedback-form').events.submit({preventDefault(){}});assert.equal(posts,1);assert.match(ui.node('#feedback-status').textContent,/Do not resend/);}
  else assert.match(ui.node('#feedback-status').textContent,/Sign-in changed/);
 }
});
test('reader feedback links carry only an allowlisted public route and the page discloses exact text and consent',()=>{
 const source='<article class="source-content"><footer class="footer">Protected source footer</footer></article>';
 const files=new Map([['read/arch-glacor/index.html',Buffer.from(source+'<footer class="footer">Old footer</footer>')],['unrecognized/index.html',Buffer.from('<footer class="footer"></footer>')]]);
 applyFeedbackPage(files,root);
 assert.ok(files.get('read/arch-glacor/index.html').toString().includes(source));
 assert.match(files.get('read/arch-glacor/index.html').toString(),/href="\/feedback\/\?context=%2Fread%2Farch-glacor%2F"/);
 assert.match(files.get('unrecognized/index.html').toString(),/href="\/feedback\/\?context=%2F"/);
 const html=files.get('feedback/index.html').toString();assert.match(html,/Exactly what will be posted/);assert.match(html,/project’s Discord feedback channel/);assert.match(html,/private guide content/);assert.match(html,/type="checkbox" required/);assert.match(html,/maxlength="600"/);assert.doesNotMatch(html,/<input[^>]*type="file"|name="email"|name="userId"/);
});
