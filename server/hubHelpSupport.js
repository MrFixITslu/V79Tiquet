// Separate customer-authorised support channel; does not reuse Sentinel grants.
import crypto from 'node:crypto';
import express from 'express';
import {sendHelpAcknowledgement} from './email.js';
export const HUB_HELP_PATH='/api/integrations/hub-help/v1/tickets';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const PORTAL_TTL_MS=14*24*60*60*1000;
const validToken=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{40,180}$/.test(v);
const portalUrlFor=token=>validToken(token)?'https://tiquet.v79sl.com/portal/'+encodeURIComponent(token):null;
const existingPortal=(row,at=Date.now())=>
 validToken(row?.secureToken)&&!row.secureTokenRevokedAt&&
 row?.secureTokenExpires&&Date.parse(row.secureTokenExpires)>at
 ?{portalUrl:portalUrlFor(row.secureToken),portalExpiresAt:row.secureTokenExpires}
 :{portalUrl:null,portalExpiresAt:null};

const fail=(status)=>Object.assign(new Error('Support request rejected'),{status});
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const id=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9._:@-]{0,179}$/i.test(v);
export function hubHelpConfig(env=process.env){
  const config={secret:env.V79_HELP_SUPPORT_SHARED_SECRET||'',accountId:env.V79_HELP_SUPPORT_ACCOUNT_ID||'',organizationId:env.V79_HELP_SUPPORT_ORGANIZATION_ID||'',ownerUserId:env.V79_HELP_SUPPORT_OWNER_USER_ID||'',ownerHubUserId:env.V79_HELP_SUPPORT_OWNER_HUB_USER_ID||''};
  return {...config,enabled:env.V79_HELP_SUPPORT_ENABLED==='1'&&Buffer.byteLength(config.secret)>=48&&['accountId','organizationId','ownerUserId','ownerHubUserId'].every(k=>id(config[k]))};
}
export function validateHubHelp(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='app,kind,requestId,requester,schemaVersion,summary'||body.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(body.requestId||''))throw fail(400);
  const r=body.requester;
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='email,name,organizationId,userId,workspace'||!id(r.organizationId)||!id(r.userId)||!text(r.name,200)||!text(r.workspace,200)||!text(r.email,254)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))throw fail(400);
  if(!['all','hub','tiquet','pos','ffpro','marketing','academy','combatzone'].includes(body.app)||!['unresolved','error'].includes(body.kind)||!text(body.summary,18000)||body.summary.trim().length<20)throw fail(400);
  return body;
}
export async function persistHubHelp(db,event,config,now=new Date().toISOString()){
  // Stable semantic digest: JSON property ordering must not turn a retry into a conflict.
  const r=event.requester;
  const digest=hash(JSON.stringify([event.app,event.kind,event.summary,r.organizationId,r.userId,r.name,r.email,r.workspace]));
  return db.transaction(async tx=>{
    await tx.query('SET LOCAL lock_timeout = \'3s\'');
    await tx.query('SET LOCAL statement_timeout = \'5s\'');
    // Serialise one requester across retries AND new keys for durable rate limits.
    const actor=hash(JSON.stringify([r.organizationId,r.userId]));
    await tx.query('SELECT pg_advisory_xact_lock(hashtext(?))',['hub-help:'+actor]);
    const account=(await tx.query('SELECT id,status,hub_organization_id FROM accounts WHERE id=? FOR SHARE',[config.accountId])).rows[0];
    const owner=(await tx.query('SELECT id,name,role,hub_user_id FROM users WHERE id=? AND account_id=? FOR SHARE',[config.ownerUserId,config.accountId])).rows[0];
    if(!account||account.status!=='active'||account.hub_organization_id!==config.organizationId||!owner||owner.role!=='Admin'||owner.hub_user_id!==config.ownerHubUserId||!text(owner.name,200))throw fail(503);
    const prior=(await tx.query('SELECT * FROM hub_help_support_receipts WHERE request_id=?',[event.requestId])).rows[0];
    if(prior){
      if(prior.body_sha256!==digest||prior.requester_hash!==actor||prior.account_id!==config.accountId)throw fail(409);
      const existing=(await tx.query('SELECT id,"secureToken","secureTokenExpires","secureTokenRevokedAt" FROM jobs WHERE id=? AND account_id=?',[prior.job_id,config.accountId])).rows[0];
      if(!existing)throw fail(410); // Retain tombstone; never resurrect a deleted ticket.
      return {accepted:true,requestId:event.requestId,reference:'HELP-'+prior.job_id,priority:'high',duplicate:true,...existingPortal(existing)};
    }
    const window=(await tx.query('SELECT COUNT(*) AS count FROM hub_help_support_receipts WHERE requester_hash=? AND created_at>=?',[actor,new Date(Date.parse(now)-3600000).toISOString()])).rows[0];
    const day=(await tx.query('SELECT COUNT(*) AS count FROM hub_help_support_receipts WHERE requester_hash=? AND created_at>=?',[actor,new Date(Date.parse(now)-86400000).toISOString()])).rows[0];
    if(Number(window.count)>=5||Number(day.count)>=10)throw fail(429);
    const jobId=crypto.randomUUID(),reference='HELP-'+jobId;
    const portalToken=crypto.randomBytes(32).toString('base64url');
    const portalExpiresAt=new Date(Date.parse(now)+PORTAL_TTL_MS).toISOString();
    const title=`[App Help] ${event.app.toUpperCase()} — ${event.kind==='error'?'Error report':'Still having issues'}`;
    const description=[`Reference: ${reference}`,`Requester: ${r.name} <${r.email}>`,`Hub workspace: ${r.workspace}`,`Hub organisation: ${r.organizationId}`,`Hub user: ${r.userId}`,'Customer-reviewed issue; guide outcomes are self-reported.',event.summary].join('\n\n');
    await tx.query('INSERT INTO jobs (id,title,client,description,status,createdAt,priority,assignedTo,clientEmail,account_id,secureToken,"secureTokenExpires",depositPaid,timeLogs,intakeEventId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)',[jobId,title,r.name,description,'request',now,'high',owner.name,r.email,config.accountId,portalToken,portalExpiresAt,'[]','hub-help:'+event.requestId]);
    await tx.query('INSERT INTO job_tags (job_id,tag,account_id) VALUES (?,?,?)',[jobId,'App Help',config.accountId]);
    await tx.query('INSERT INTO activity_logs (id,job_id,action,timestamp,"user",account_id) VALUES (?,?,?,?,?,?)',[crypto.randomUUID(),jobId,'Customer submitted reviewed App Help issue; High priority',now,'V79 Hub Help',config.accountId]);
    await tx.query('INSERT INTO notifications (id,user_id,title,message,type,createdAt,account_id,isRead) VALUES (?,?,?,?,?,?,?,0)',[crypto.randomUUID(),owner.id,'High-priority App Help ticket',`${title} · ${reference}`,'assignment',now,config.accountId]);
    await tx.query('INSERT INTO hub_help_support_receipts (request_id,requester_hash,body_sha256,job_id,account_id,created_at) VALUES (?,?,?,?,?,?)',[event.requestId,actor,digest,jobId,config.accountId,now]);
    return {accepted:true,requestId:event.requestId,reference,priority:'high',duplicate:false,portalUrl:portalUrlFor(portalToken),portalExpiresAt,ackTo:r.email,app:event.app};
  })();
}
export function createHubHelpRouter({db,config=hubHelpConfig(),clock=Date.now,acknowledger=sendHelpAcknowledgement}){
  const router=express.Router();let active=0;
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  router.post('/',async(req,res)=>{
    if(!config.enabled)return res.status(404).json({error:'Not found'});
    try{
      if(req.headers.origin||req.headers.cookie||req.headers.authorization)throw fail(403);
      if(req.get('x-v79-service-id')!=='v79-hub-help')throw fail(401);
      if(!req.is('application/json')||!Buffer.isBuffer(req.rawBody)||req.rawBody.length>32000)throw fail(413);
      const timestamp=req.get('x-v79-timestamp'),signature=req.get('x-v79-signature');
      if(!/^\d{13}$/.test(timestamp||'')||Math.abs(clock()-Number(timestamp))>300000||!/^[a-f0-9]{64}$/.test(signature||''))throw fail(401);
      const expected=crypto.createHmac('sha256',config.secret).update(['POST',HUB_HELP_PATH,timestamp,hash(req.rawBody)].join('\n')).digest();
      if(!crypto.timingSafeEqual(expected,Buffer.from(signature,'hex')))throw fail(401);
      const event=validateHubHelp(req.body);
      if(active>=8)throw fail(429);
      active++;
      try{
        const receipt=await persistHubHelp(db,event,config);
        const {ackTo,app,...publicReceipt}=receipt;
        const queueEmail=!receipt.duplicate&&Boolean(receipt.portalUrl)&&
          typeof ackTo==='string'&&config.enabled&&process.env.V79_HELP_SUPPORT_ACK_EMAIL_ENABLED==='1';
        res.status(receipt.duplicate?200:201).json({...publicReceipt,
          acknowledgementEmail:queueEmail?'queued':'not_queued'});
        if(queueEmail){
          // Do not delay ticket confirmation behind SMTP latency. Only one
          // attempt for the unique committed request; retries never resend.
          setImmediate(async()=>{
            let delivered=false;
            try{
              const sent=await acknowledger(ackTo,{reference:receipt.reference,app,
                portalUrl:receipt.portalUrl,expiresAt:receipt.portalExpiresAt});
              delivered=sent?.success===true&&!sent.skipped;
            }catch{}
            try{
              await db.prepare('INSERT INTO activity_logs (id,job_id,action,timestamp,"user",account_id) VALUES (?,?,?,?,?,?)')
                .run(crypto.randomUUID(),receipt.reference.slice(5),
                  delivered?'Customer Care acknowledgement email accepted by SMTP':'Customer Care acknowledgement delivery UNKNOWN',
                  new Date(clock()).toISOString(),'V79 Customer Care',config.accountId);
            }catch{}
          });
        }
        return;
      }finally{active--;}
    }catch(error){const status=[400,401,403,409,410,413,429].includes(error.status)?error.status:503;if(status===429)res.setHeader('Retry-After','60');return res.status(status).json({error:status===503?'Support integration unavailable':'Support request rejected'});}
  });
  return router;
}
