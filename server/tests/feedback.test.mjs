import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, request } from './harness.mjs';
import { createHandler } from '../http.mjs';
import { loadConfig } from '../config.mjs';
import { safeEditorReturn } from '../auth.mjs';
import { feedbackConfig, feedbackInput, createFeedback } from '../feedback.mjs';
import { feedbackContexts } from '../../scripts/feedback-contexts.mjs';
import { feedbackMessage } from '../../editor/shared/feedback.mjs';
const webhookId='123456789012345678';
const endpoint='https://discord.com/api/webhooks/'+webhookId+'/'+'fixtureToken'.repeat(7);
const settings=feedbackConfig({VERCEL_ENV:'production',PVME_FEEDBACK_DISCORD_ENABLED:'1',PVME_FEEDBACK_DISCORD_WEBHOOK_URL:endpoint});
const payload=(message='The mobile search button is hard to find.')=>({requestId:randomUUID(),category:'navigation',context:'/read/arch-glacor/',message,confirmed:true});
const ack=()=>Response.json({id:'234567890123456789',webhook_id:webhookId});
const handler=(f,fetchImpl)=>createHandler({db:f.db,config:{...f.config,feedback:settings},feedbackFetch:fetchImpl});

test('feedback configuration is production-only, exact, secret-bearing and independently fail-closed',()=>{
 const env={APP_ORIGIN:'https://pvme.example',DATABASE_URL:'postgresql://fixture:fixture@db.example.invalid/pvme',SESSION_SECRET:'x'.repeat(40),DISCORD_CLIENT_ID:'123456',DISCORD_CLIENT_SECRET:'fixture-only',PVME_ACCESS_MODE:'open',VERCEL_ENV:'production',PVME_FEEDBACK_DISCORD_ENABLED:'1',PVME_FEEDBACK_DISCORD_WEBHOOK_URL:endpoint};
 assert.ok(loadConfig(env).feedback);assert.equal(loadConfig(env).configured,true);
 for(const VERCEL_ENV of [undefined,'preview','development','Production'])assert.equal(feedbackConfig({...env,VERCEL_ENV}),null);
 for(const flag of [undefined,'','0','true',' 1',true])assert.equal(feedbackConfig({...env,PVME_FEEDBACK_DISCORD_ENABLED:flag}),null);
 for(const url of [endpoint+'?wait=true',endpoint+'#x',endpoint+'/',endpoint.replace('https:','http:'),endpoint.replace('discord.com','discord.com.evil.invalid'),endpoint.replace('discord.com','discordapp.com'),endpoint.replace('discord.com','user:pass@discord.com'),endpoint.replace('/api/','/api/../api/'),endpoint.replace('discord.com','discord.com:443'),endpoint+'\n']){
  const config=loadConfig({...env,PVME_FEEDBACK_DISCORD_WEBHOOK_URL:url});assert.equal(config.feedback,null);assert.equal(config.configured,true,'Bad feedback setup must not break contributor sign-in');
 }
});
test('feedback fields, local public routes, consent and contact-free short text are strict',()=>{
 const contexts=feedbackContexts();assert.ok(contexts.has('/read/arch-glacor/'));
 assert.equal(feedbackInput(payload(),contexts).context,'/read/arch-glacor/');
 for(const mutate of [p=>p.email='private@example.invalid',p=>p.attachments=[],p=>p.userId='secret',p=>p.context='/edit/#/submission/private',p=>p.context='/read/arch-glacor/?private=yes',p=>p.context='https://pvme.example/',p=>p.context='/api/editor/',p=>p.context='/not-a-real-guide/',p=>p.confirmed=false,p=>p.requestId='not-a-uuid',p=>p.requestId=[p.requestId],p=>p.category=['bug'],p=>p.category='arbitrary',p=>p.message='x',p=>p.message='x'.repeat(601),p=>p.message='Email me private@example.invalid',p=>p.message='Visit https://evil.invalid',p=>p.message='My account is 123456789012345678',p=>p.message='Ping @everyone',p=>p.message='Call +1 (555) 555-5555',p=>p.message='Bad\u0000control']){
  const input=payload();mutate(input);assert.throws(()=>feedbackInput(input,contexts),error=>error.status===400&&['invalid_feedback','invalid_input'].includes(error.code));
 }
 assert.equal(safeEditorReturn('/feedback/'),'/feedback/');
 for(const bad of ['/feedback/?context=/edit/','/feedback/#private','/feedback//','https://pvme.example/feedback/','/feedback/\n'])assert.equal(safeEditorReturn(bad),'/edit/');
});
test('only the exact reviewed text is posted; no identity, contact, query, IP or webhook secret is forwarded',async t=>{
 const f=await fixture();t.after(()=>f.db.close());const user=await f.user();const input=payload();let calls=0;
 const response=await handler(f,async(url,init)=>{
  calls++;assert.equal(url,endpoint+'?wait=true');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.ok(init.signal);
  assert.deepEqual(init.headers,{'Content-Type':'application/json'});
  const posted=JSON.parse(init.body);
  assert.deepEqual(posted,{content:feedbackMessage(input.category,input.context,input.message),allowed_mentions:{parse:[]},flags:4,tts:false});
  for(const secret of [user.id,user.discordId,user.token,user.csrf,input.requestId,'203.0.113.22','private-query',endpoint])assert.ok(!init.body.includes(secret));
  return ack();
 })(request('feedback?route=feedback',{user,method:'POST',body:input,headers:{'x-vercel-forwarded-for':'203.0.113.22',referer:'https://pvme.example/edit/?private-query'}}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{posted:true});assert.equal(calls,1);
 const rows=(await f.db.query("SELECT key FROM rate_limits WHERE key LIKE 'feedback:%'")).rows;
 assert.equal(rows.length,4);for(const row of rows){assert.ok(!row.key.includes(user.id));assert.ok(!row.key.includes(input.message));}
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
test('feedback uses the existing session, origin and CSRF checks; route/method/body variants cannot post',async t=>{
 const f=await fixture();t.after(()=>f.db.close());const user=await f.user();let calls=0;const run=handler(f,async()=>{calls++;return ack();});
 for(const [path,options,status] of [
  ['feedback',{method:'POST',body:payload()},401],
  ['feedback',{user,method:'POST',body:payload(),origin:'https://evil.invalid'},403],
  ['feedback',{user,method:'POST',body:payload(),headers:{'X-CSRF-Token':'wrong'}},403],
  ['feedback/',{user,method:'POST',body:payload()},400],
  ['feedback?private=value',{user,method:'POST',body:payload()},400],
  ['feedback?route=feedback&private=value',{user,method:'POST',body:payload()},400],
  ['feedback?route=feedback&route=feedback',{user,method:'POST',body:payload()},400],
  ['feedback?route=other',{user,method:'POST',body:payload()},400],
  ['feedback',{user,method:'PUT',body:payload()},405],
  ['feedback',{user,method:'POST',body:payload(),headers:{'Content-Type':'text/plain'}},415],
  ['feedback',{user,method:'POST',body:JSON.stringify({message:'x'.repeat(9000)})},413],
 ])assert.equal((await run(request(path,options))).status,status,path);
 await f.db.query('UPDATE users SET disabled=true WHERE id=$1',[user.id]);
 assert.equal((await run(request('feedback',{user,method:'POST',body:payload()}))).status,401);assert.equal(calls,0);
});
test('disabled and read-only Preview feedback never touches Discord, even with credentials present',async t=>{
 const f=await fixture();t.after(()=>f.db.close());const user=await f.user();let calls=0;
 for(const config of [{...f.config,feedback:null},{configured:false,feedback:null}]){
  const run=createHandler({db:f.db,config,feedbackFetch:async()=>{calls++;return ack();}});
  for(const url of ['https://pvme.example/api/editor/feedback','https://pvme.example/api/editor/feedback?route=feedback','https://pvme.example/api/editor?route=feedback'])assert.deepEqual(await(await run(new Request(url))).json(),{enabled:false});
  assert.equal((await run(request('feedback',{user,method:'POST',body:payload()}))).status,503);
 }
 assert.equal(calls,0);
});
test('Discord failure, timeout, redirect, malformed or missing acknowledgement never claims success or retries',async t=>{
 const f=await fixture();t.after(()=>f.db.close());
 const failures=[()=>{throw Error(endpoint+' must never leak');},()=>new Response(null,{status:302,headers:{Location:'https://evil.invalid'}}),()=>new Response('upstream secret '+endpoint,{status:429}),()=>new Response(null,{status:204}),()=>Response.json({id:'234567890123456789',webhook_id:'different'}),()=>Response.json({id:['234567890123456789'],webhook_id:webhookId}),()=>new Response('not json',{status:200,headers:{'Content-Type':'application/json'}}),()=>new Response('x'.repeat(17000),{status:200,headers:{'Content-Type':'application/json'}}),()=>new Response('failure',{status:500})];
 for(const failure of failures){
  const user=await f.user(),input=payload();let calls=0;
  const run=handler(f,async()=>{calls++;return failure();});
  const response=await run(request('feedback',{user,method:'POST',body:input}));
  assert.equal(response.status,502);const text=await response.text();assert.ok(!text.includes(endpoint));assert.match(text,/may have arrived/);
  assert.equal((await run(request('feedback',{user,method:'POST',body:input}))).status,409);
  const restarted=handler(f,async()=>{calls++;return ack();});
  assert.equal((await restarted(request('feedback',{user,method:'POST',body:{...input,requestId:randomUUID()}}))).status,409);
  assert.equal(calls,1);
 }
});
test('concurrent duplicate content has a single external delivery',async t=>{
 const f=await fixture();t.after(()=>f.db.close());const user=await f.user();let calls=0;
 const run=handler(f,async()=>{calls++;return ack();});
 const input=payload();const results=await Promise.all([run(request('feedback',{user,method:'POST',body:input})),run(request('feedback',{user,method:'POST',body:{...input,requestId:randomUUID()}}))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(calls,1);
});
test('feedback caps are lower than ordinary editing and remain DB-enforced across handler instances',async t=>{
 const f=await fixture();t.after(()=>f.db.close());const user=await f.user();let calls=0;
 const send=async input=>handler(f,async()=>{calls++;return ack();})(request('feedback',{user,method:'POST',body:input}));
 for(const word of ['first','second','third'])assert.equal((await send(payload('The '+word+' navigation item needs a clearer label.'))).status,200);
 const limited=await send(payload('The fourth navigation item needs a clearer label.'));assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'3600');assert.equal(calls,3);
 await f.db.query("UPDATE rate_limits SET count=30 WHERE key='feedback:global'");
 const another=await f.user();const response=await handler(f,async()=>{calls++;return ack();})(request('feedback',{user:another,method:'POST',body:payload()}));assert.equal(response.status,429);assert.equal(calls,3);
});
test('reservation/DB failure fails closed before any Discord request',async()=>{
 let calls=0;
 const send=createFeedback({db:{query(){throw Error('unavailable');}},config:{feedback:settings,sessionSecret:'fixture-only'},fetchImpl:async()=>{calls++;return ack();}});
 await assert.rejects(send('fixture-user',payload()));assert.equal(calls,0);
});
