import { feedbackConfig } from './config.mjs';
export { feedbackConfig };
import { createHmac } from 'node:crypto';
import { fail, fields } from './core.mjs';
import { feedbackContexts } from '../scripts/feedback-contexts.mjs';
import { FEEDBACK_CATEGORIES, feedbackMessage, feedbackTextError } from '../editor/shared/feedback.mjs';
export const FEEDBACK_ACCOUNT_CAP=3, FEEDBACK_GLOBAL_CAP=30;

export function feedbackInput(input, contexts) {
  fields(input,['requestId','category','context','message','confirmed']);
  if (Object.keys(input).length!==5 || typeof input.requestId!=='string' || typeof input.category!=='string' || typeof input.context!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId || '') || !Object.hasOwn(FEEDBACK_CATEGORIES,input.category) || !contexts.has(input.context) || input.confirmed!==true) fail(400,'invalid_feedback','Choose a category, a known public page and confirm the exact message.');
  const error=feedbackTextError(input.message);
  if (error) fail(400,'invalid_feedback',error);
  return { ...input, message:input.message.trim() };
}
async function limit(db,key,cap) {
  const row=(await db.query(`INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 hour')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<=now() THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<=now() THEN now()+interval '1 hour' ELSE rate_limits.expires_at END RETURNING count`,[key])).rows[0];
  if (row.count>cap) fail(429,'feedback_rate_limited','Feedback is limited to 3 attempts per account and 30 site-wide per hour. Nothing was posted by this attempt.');
}
export function createFeedback({ db, config, fetchImpl=fetch, contexts=feedbackContexts() }) {
  return async (userId,raw) => {
    const settings=config.feedback;
    if (!settings || !feedbackConfig({VERCEL_ENV:'production',PVME_FEEDBACK_DISCORD_ENABLED:'1',PVME_FEEDBACK_DISCORD_WEBHOOK_URL:settings.webhookUrl})) fail(503,'feedback_disabled','Website feedback is unavailable here. Nothing was posted.');
    const input=feedbackInput(raw,contexts), content=feedbackMessage(input.category,input.context,input.message);
    const digest=value=>createHmac('sha256',config.sessionSecret).update(value).digest('hex');
    await limit(db,`feedback:account:${digest(userId)}`,FEEDBACK_ACCOUNT_CAP);
    await limit(db,'feedback:global',FEEDBACK_GLOBAL_CAP);
    // Existing transient rate-limit storage, not a retained feedback inbox.
    // Both keys reserve before the external POST. Uncertain delivery is never
    // retried, even with a new request ID and the same account/message.
    const keys=[`feedback:attempt:${digest(userId+'\0'+input.requestId)}`,`feedback:content:${digest(userId+'\0'+content)}`];
    await db.transaction(async q=>{
      const reserved=await q.query(`INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '24 hours'),($2,1,now()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING key`,keys);
      if(reserved.rows.length!==2)fail(409,'feedback_already_attempted','This report was already attempted. It may already be in Discord; do not resend it.');
    });
    // One request only: no queue, background job, bot reads or retries.
    try {
      const response=await fetchImpl(settings.webhookUrl+'?wait=true',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},
        body:JSON.stringify({content,allowed_mentions:{parse:[]},flags:4,tts:false}),
      });
      if(response.status!==200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error();
      const reader=response.body?.getReader();if(!reader)throw Error();
      let bytes=0;const chunks=[];
      while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384){await reader.cancel();throw Error();}chunks.push(value);}
      const ack=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const webhookId=settings.webhookUrl.split('/').at(-2);
      if(typeof ack.id!=='string' || !/^[0-9]{17,22}$/.test(ack.id) || ack.webhook_id!==webhookId)throw Error();
      return {posted:true};
    } catch {
      // Never echo Discord errors, response bodies, webhook URLs or tokens.
      fail(502,'feedback_unconfirmed','Discord did not confirm delivery. The report may have arrived; do not resend it.');
    }
  };
}
