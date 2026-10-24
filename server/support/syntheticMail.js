import crypto from "node:crypto";
import {SupportError} from "./contracts.js";
import {supportCapabilities} from "./permissions.js";
import {requireMailSandbox,mailAddress,verifiedInbound,outgoingInput,hashInbound,hashOutgoing,rfcId} from "./mailContracts.js";

// No Nodemailer, IMAP, fetch, timers, sockets, live credentials or real providers.
// Only the explicitly injected synthetic-mail-provider can receive outgoing data.
const txRun=(db,fn)=>db.transaction(fn)();
const missing=(code="MAIL_RECORD_NOT_FOUND")=>{throw new SupportError(404,code);};
const uuid=()=>crypto.randomUUID();
const audit=async(tx,account,ticket,event,details)=>{
 await tx.query("INSERT INTO support_events(id,account_id,ticket_id,actor_id,event_type,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
  [uuid(),account,ticket,"system:synthetic-mail",event,JSON.stringify(details)]);
};
async function mailbox(tx,account,id){
 const r=await tx.query("SELECT id,address FROM support_mailboxes WHERE account_id=$1 AND id=$2 AND active=TRUE FOR SHARE",
  [account,id]);
 if(!r.rows.length)missing("MAILBOX_NOT_FOUND");
 return r.rows[0];
}
function assertAccount(account){
 if(typeof account!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(account))
  throw new SupportError(400,"INVALID_ACCOUNT");
 return account;
}
function assertScope(actor,ticket,caps){
 if(!caps.has("support.reply"))throw new SupportError(403,"SUPPORT_REPLY_FORBIDDEN");
 if(!caps.has("support.view.all")&&ticket.created_by!==actor&&ticket.assigned_to!==actor)
  missing("TICKET_NOT_FOUND");
}
export function createSyntheticMailService({db,transport,env=process.env}){
 requireMailSandbox(env);
 if(!db?.query||!db?.transaction||transport?.kind!=="synthetic-mail-provider"||
    typeof transport.send!=="function")
  throw new Error("SUPPORT_MAIL_MOCK_TRANSPORT_REQUIRED");
 async function ingest(accountId,raw){
  requireMailSandbox(env);
  const account=assertAccount(accountId),mail=verifiedInbound(raw),hash=hashInbound(mail);
  return txRun(db,async tx=>{
   await mailbox(tx,account,mail.mailboxId);
   // First claim the external identity. Unique indexes serialize competing imports.
   const claim=await tx.query(
    "INSERT INTO support_mail_ingest(account_id,mailbox_id,provider_uid,rfc_id,payload_hash) VALUES($1,$2,$3,$4,$5) "+
    "ON CONFLICT DO NOTHING RETURNING provider_uid",
    [account,mail.mailboxId,mail.providerUid,mail.messageId,hash]);
   if(!claim.rows.length){
    const found=await tx.query(
     "SELECT provider_uid,rfc_id,payload_hash,ticket_id,message_id FROM support_mail_ingest "+
     "WHERE account_id=$1 AND mailbox_id=$2 AND (provider_uid=$3 OR rfc_id=$4) FOR UPDATE",
     [account,mail.mailboxId,mail.providerUid,mail.messageId]);
    if(found.rows.length!==1||found.rows[0].payload_hash!==hash)
     throw new SupportError(409,"INBOUND_IDENTITY_COLLISION");
    if(!found.rows[0].ticket_id||!found.rows[0].message_id)
     throw new SupportError(503,"INGEST_NOT_COMMITTED");
    return {duplicate:true,ticketId:found.rows[0].ticket_id,messageId:found.rows[0].message_id};
   }
   // Thread matching is ONLY by exact RFC IDs scoped to tenant+mailbox, never subject.
   // Ambiguous multiple-ticket references are rejected; an unknown participant
   // starts a new ticket instead of being shown someone else's conversation.
   let matched=null;
   if(mail.references.length){
    const rows=await tx.query(
     "SELECT DISTINCT ticket_id FROM support_mail_references "+
     "WHERE account_id=$1 AND mailbox_id=$2 AND rfc_id=ANY($3::text[])",
     [account,mail.mailboxId,mail.references]);
    if(rows.rows.length>1)throw new SupportError(409,"AMBIGUOUS_THREAD");
    if(rows.rows.length===1){
     const candidate=rows.rows[0].ticket_id;
     const member=await tx.query(
      "SELECT 1 FROM support_mail_participants WHERE account_id=$1 AND ticket_id=$2 AND email=$3",
      [account,candidate,mail.sender]);
     if(member.rows.length)matched=candidate;
    }
   }
   const ticketId=matched??uuid(),messageId=uuid();
   if(!matched){
    await tx.query(
     "INSERT INTO support_tickets(id,account_id,subject,status,priority,created_by) "+
     "VALUES($1,$2,$3,'new','normal','system:synthetic-mail')",
     [ticketId,account,mail.subject]);
    await tx.query(
     "INSERT INTO support_mail_participants(account_id,ticket_id,email) VALUES($1,$2,$3)",
     [account,ticketId,mail.sender]);
    await audit(tx,account,ticketId,"mail.ticket_created",{mailboxId:mail.mailboxId});
   }
   await tx.query(
    "INSERT INTO support_messages(id,account_id,ticket_id,actor_id,visibility,channel,direction,delivery_state,body,idem_key,body_hash) "+
    "VALUES($1,$2,$3,$4,'public','email','inbound','not_applicable',$5,$6,$7)",
    [messageId,account,ticketId,"mail:"+mail.sender,mail.body,mail.providerUid,hash]);
   // A reference reused for another message must not silently rebind tickets.
   const reference=await tx.query(
    "INSERT INTO support_mail_references(account_id,mailbox_id,rfc_id,ticket_id) VALUES($1,$2,$3,$4) "+
    "ON CONFLICT DO NOTHING RETURNING ticket_id",
    [account,mail.mailboxId,mail.messageId,ticketId]);
   if(!reference.rows.length)throw new SupportError(409,"RFC_ID_ALREADY_CLAIMED");
   await tx.query(
    "UPDATE support_mail_ingest SET ticket_id=$4,message_id=$5 "+
    "WHERE account_id=$1 AND mailbox_id=$2 AND provider_uid=$3",
    [account,mail.mailboxId,mail.providerUid,ticketId,messageId]);
   await audit(tx,account,ticketId,"mail.inbound_received",{messageId,mailboxId:mail.mailboxId});
   return {duplicate:false,ticketId,messageId,threaded:Boolean(matched)};
  });
 }
 async function queueReply(raw){
  requireMailSandbox(env);
  const mail=outgoingInput(raw),hash=hashOutgoing(mail);
  return txRun(db,async tx=>{
   const actor=(await tx.query("SELECT role,permissions FROM users WHERE account_id=$1 AND id=$2",
    [mail.accountId,mail.actorId])).rows[0];
   if(!actor)throw new SupportError(403,"SUPPORT_REPLY_FORBIDDEN");
   const target=(await tx.query(
    "SELECT id,created_by,assigned_to FROM support_tickets WHERE account_id=$1 AND id=$2 FOR UPDATE",
    [mail.accountId,mail.ticketId])).rows[0];
   if(!target)missing("TICKET_NOT_FOUND");
   assertScope(mail.actorId,target,supportCapabilities(actor));
   await mailbox(tx,mail.accountId,mail.mailboxId);
   const participant=await tx.query(
    "SELECT 1 FROM support_mail_participants WHERE account_id=$1 AND ticket_id=$2 AND email=$3",
    [mail.accountId,mail.ticketId,mail.recipient]);
   if(!participant.rows.length)throw new SupportError(409,"RECIPIENT_NOT_PARTICIPANT");
   const existing=await tx.query(
    "SELECT id,payload_hash,state,message_id FROM support_outbox "+
    "WHERE account_id=$1 AND actor_id=$2 AND idem_key=$3",
    [mail.accountId,mail.actorId,mail.key]);
   if(existing.rows.length){
    if(existing.rows[0].payload_hash!==hash)
     throw new SupportError(409,"IDEMPOTENCY_CONFLICT");
    return {duplicate:true,outboxId:existing.rows[0].id,messageId:existing.rows[0].message_id,state:existing.rows[0].state};
   }
   const messageId=uuid(),outboxId=uuid();
   const rfcMessageId=rfcId("<tiquet-"+outboxId+"@example.invalid>");
   await tx.query(
    "INSERT INTO support_messages(id,account_id,ticket_id,actor_id,visibility,channel,direction,delivery_state,body,idem_key,body_hash) "+
    "VALUES($1,$2,$3,$4,'public','email','outbound','queued',$5,$6,$7)",
    [messageId,mail.accountId,mail.ticketId,mail.actorId,mail.body,mail.key,hash]);
   const stored=await tx.query(
    "INSERT INTO support_outbox(id,account_id,mailbox_id,ticket_id,message_id,actor_id,idem_key,payload_hash,recipient,rfc_id) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id",
    [outboxId,mail.accountId,mail.mailboxId,mail.ticketId,messageId,mail.actorId,mail.key,hash,mail.recipient,rfcMessageId]);
   if(!stored.rows.length)throw new SupportError(409,"IDEMPOTENCY_CONFLICT");
   await audit(tx,mail.accountId,mail.ticketId,"mail.outbound_queued",{messageId,outboxId});
   return {duplicate:false,outboxId,messageId,state:"queued"};
  });
 }
 async function finish(claim,outcome){
  const valid=new Set(["accepted","retryable_failure","permanent_failure","uncertain"]);
  const state=valid.has(outcome?.state)?outcome.state:"uncertain";
  return txRun(db,async tx=>{
   const current=(await tx.query(
    "SELECT * FROM support_outbox WHERE id=$1 AND state='sending' AND lease_token=$2 FOR UPDATE",
    [claim.id,claim.lease_token])).rows[0];
   if(!current)return {stale:true};
   const finalState=state==="accepted"?"accepted":state==="retryable_failure"?
    (current.attempts>=3?"failed":"queued"):state==="permanent_failure"?"failed":"uncertain";
   const seconds=finalState==="queued"?Math.min(3600,30*2**(current.attempts-1)):0;
   await tx.query(
    "UPDATE support_outbox SET state=$2,next_attempt_at=now()+($3 * interval '1 second'), "+
    "lease_token=NULL,lease_until=NULL,provider_receipt=$4,error_code=$5,updated_at=now() WHERE id=$1",
    [claim.id,finalState,seconds,state==="accepted"?String(outcome.receipt||"synthetic-accepted").slice(0,160):null,
     finalState==="accepted"?null:state]);
   await tx.query("UPDATE support_messages SET delivery_state=$2 WHERE account_id=$3 AND ticket_id=$4 AND id=$1",
    [current.message_id,finalState,current.account_id,current.ticket_id]);
   if(finalState==="accepted"){
    await tx.query(
     "INSERT INTO support_mail_references(account_id,mailbox_id,rfc_id,ticket_id) VALUES($1,$2,$3,$4) "+
     "ON CONFLICT DO NOTHING",
     [current.account_id,current.mailbox_id,current.rfc_id,current.ticket_id]);
   }
   await audit(tx,current.account_id,current.ticket_id,"mail.delivery_state",
    {outboxId:current.id,state:finalState,attempts:current.attempts});
   return {stale:false,outboxId:claim.id,state:finalState,attempts:current.attempts};
  });
 }
 async function dispatchOne(){
  requireMailSandbox(env);
  const claim=await txRun(db,async tx=>{
   const row=await tx.query(
    "SELECT id FROM support_outbox WHERE state='queued' AND next_attempt_at<=now() "+
    "ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1");
   if(!row.rows.length)return null;
   const lease=uuid();
   const data=await tx.query(
    "UPDATE support_outbox SET state='sending',attempts=attempts+1,lease_token=$2,"+
    "lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=$1 RETURNING *",
    [row.rows[0].id,lease]);
   const outgoing=data.rows[0];
   await tx.query(
    "UPDATE support_messages SET delivery_state='sending' "+
    "WHERE account_id=$1 AND ticket_id=$2 AND id=$3",
    [outgoing.account_id,outgoing.ticket_id,outgoing.message_id]);
   return outgoing;
  });
  if(!claim)return {idle:true};
  // The mock is the ONLY transport. Any throw is ambiguous, NOT a retryable error.
  let result;
  try{
   const body=(await db.query(
    "SELECT body FROM support_messages WHERE account_id=$1 AND ticket_id=$2 AND id=$3",
    [claim.account_id,claim.ticket_id,claim.message_id])).rows[0];
   if(!body)throw new Error("MESSAGE_MISSING");
   result=await transport.send(Object.freeze({
    to:mailAddress(claim.recipient),messageId:claim.rfc_id,body:body.body,
    mailboxId:claim.mailbox_id,accountId:claim.account_id,
    outboxId:claim.id
   }));
  }catch{
   result={state:"uncertain"};
  }
  return finish(claim,result);
 }
 async function reapExpired(){
  requireMailSandbox(env);
  return txRun(db,async tx=>{
   const expired=await tx.query(
    "SELECT id,account_id,ticket_id,message_id FROM support_outbox "+
    "WHERE state='sending' AND lease_until<now() FOR UPDATE SKIP LOCKED");
   for(const row of expired.rows){
    await tx.query("UPDATE support_outbox SET state='uncertain',lease_token=NULL,lease_until=NULL,"+
     "error_code='LEASE_EXPIRED',updated_at=now() WHERE id=$1",[row.id]);
    await tx.query("UPDATE support_messages SET delivery_state='uncertain' "+
     "WHERE account_id=$1 AND ticket_id=$2 AND id=$3",
     [row.account_id,row.ticket_id,row.message_id]);
    await audit(tx,row.account_id,row.ticket_id,"mail.lease_expired",{outboxId:row.id});
   }
   return {uncertain:expired.rows.length};
  });
 }
 async function reconcile({accountId,outboxId,state,proof}){
  requireMailSandbox(env);
  assertAccount(accountId);
  if(!["accepted","failed"].includes(state)||typeof proof!=="string"||
    !/^synthetic-proof-[a-zA-Z0-9_-]{8,100}$/.test(proof))
   throw new SupportError(400,"SYNTHETIC_RECONCILIATION_REQUIRED");
  return txRun(db,async tx=>{
   const row=(await tx.query(
    "SELECT * FROM support_outbox WHERE account_id=$1 AND id=$2 AND state='uncertain' FOR UPDATE",
    [accountId,outboxId])).rows[0];
   if(!row)missing("UNCERTAIN_OUTBOX_NOT_FOUND");
   await tx.query("UPDATE support_outbox SET state=$2,provider_receipt=$3,error_code=NULL,updated_at=now() WHERE id=$1",
    [row.id,state,state==="accepted"?proof:null]);
   await tx.query("UPDATE support_messages SET delivery_state=$2 WHERE account_id=$3 AND ticket_id=$4 AND id=$1",
    [row.message_id,state,row.account_id,row.ticket_id]);
   if(state==="accepted")await tx.query(
    "INSERT INTO support_mail_references(account_id,mailbox_id,rfc_id,ticket_id) "+
    "VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [row.account_id,row.mailbox_id,row.rfc_id,row.ticket_id]);
   await audit(tx,row.account_id,row.ticket_id,"mail.manual_reconciliation",{outboxId,state});
   return {outboxId:row.id,state};
  });
 }
 return Object.freeze({ingest,queueReply,dispatchOne,reapExpired,reconcile});
}
