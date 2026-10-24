import crypto from "node:crypto";
import {SupportError} from "./contracts.js";
import {requireMailSandbox} from "./mailContracts.js";
import {addBusinessMinutes,businessMinutesBetween,validateCalendar,currentSlaState,DEFAULT_TARGETS} from "./businessHours.js";

const txRun=(db,fn)=>db.transaction(fn)();
const uuid=()=>crypto.randomUUID();
const notFound=()=>{throw new SupportError(404,"TICKET_NOT_FOUND");};
const asIso=x=>new Date(x).toISOString();
const CALENDAR_SQL="SELECT timezone,start_minute AS \"startMinute\",end_minute AS \"endMinute\",weekdays,holidays FROM support_sla_policies WHERE account_id=$1";
const ticketSql="SELECT id,account_id,subject,status,priority,assigned_to,created_by,version,created_at "+
 "FROM support_tickets WHERE account_id=$1 AND id=$2";
function ensureAccount(account){
 if(typeof account!=="string"||!/^[a-zA-Z0-9_-]{1,128}$/.test(account))
  throw new SupportError(400,"INVALID_ACCOUNT");
 return account;
}
function protectTicket(ticket,actor,caps){
 if(!ticket)notFound();
 if(!caps?.has("support.view.all")&&ticket.assigned_to!==actor&&ticket.created_by!==actor)
  notFound();
}
function checkedDate(date){
 const d=new Date(date);
 if(!Number.isFinite(d.getTime()))throw new SupportError(400,"INVALID_SLA_DATE");
 return d;
}
export function createPhase4Service({db,env=process.env,clock=()=>new Date()}){
 requireMailSandbox(env);
 if(!db?.query||!db?.transaction)throw new Error("PHASE4_DATABASE_REQUIRED");
 const at=()=>checkedDate(clock());
 async function policy(tx,account){
  const found=await tx.query(CALENDAR_SQL,[account]);
  if(!found.rows.length)throw new SupportError(422,"SLA_POLICY_UNCONFIGURED");
  return validateCalendar(found.rows[0]);
 }
 async function ticket(tx,account,id){
  const rows=await tx.query(ticketSql+" FOR UPDATE",[account,id]);
  if(!rows.rows[0])notFound();
  return rows.rows[0];
 }
 async function ensureRecord(tx,t,p,now){
  let rows=await tx.query("SELECT * FROM support_sla_records WHERE account_id=$1 AND ticket_id=$2 FOR UPDATE",
   [t.account_id,t.id]);
  if(rows.rows[0])return rows.rows[0];
  const target=DEFAULT_TARGETS[t.priority];
  const result=await tx.query("INSERT INTO support_sla_records "+
   "(account_id,ticket_id,first_response_due,resolution_due,paused_at,resolved_at) "+
   "VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *",
   [t.account_id,t.id,addBusinessMinutes(t.created_at,target.first,p),
    addBusinessMinutes(t.created_at,target.resolve,p),
    t.status==="waiting_customer"?now:null,
    ["resolved","closed"].includes(t.status)?now:null]);
  if(result.rows[0])return result.rows[0];
  rows=await tx.query("SELECT * FROM support_sla_records WHERE account_id=$1 AND ticket_id=$2 FOR UPDATE",
   [t.account_id,t.id]);
  return rows.rows[0];
 }
 async function applyResponse(tx,t,record){
  if(record.first_response_at)return record;
  // The only qualifying response is an accepted public email from a real
  // synthetic *staff user*. Auto-acknowledgements, inbound mail, drafts
  // and unaccepted outbox messages cannot satisfy first response SLA.
  const q=await tx.query("SELECT COALESCE(o.updated_at,m.created_at) AS accepted_at "+
   "FROM support_messages m JOIN users u "+
   "ON u.account_id=m.account_id AND u.id=m.actor_id "+
   "LEFT JOIN support_outbox o ON o.account_id=m.account_id "+
   "AND o.ticket_id=m.ticket_id AND o.message_id=m.id "+
   "WHERE m.account_id=$1 AND m.ticket_id=$2 AND m.visibility='public' "+
   "AND m.direction='outbound' AND m.delivery_state='accepted' "+
   "AND (o.id IS NULL OR o.state='accepted') "+
   "ORDER BY accepted_at ASC,m.id ASC LIMIT 1",[t.account_id,t.id]);
  if(!q.rows[0])return record;
  const r=await tx.query("UPDATE support_sla_records SET first_response_at=$3,updated_at=now() "+
   "WHERE account_id=$1 AND ticket_id=$2 RETURNING *",
   [t.account_id,t.id,q.rows[0].accepted_at]);
  return r.rows[0];
 }
 async function readSla({accountId,ticketId,actorId,caps}){
  requireMailSandbox(env);ensureAccount(accountId);
  return txRun(db,async tx=>{
   const t=await ticket(tx,accountId,ticketId);
   protectTicket(t,actorId,caps);
   const p=await policy(tx,accountId);
   let r=await ensureRecord(tx,t,p,at());
   r=await applyResponse(tx,t,r);
   return currentSlaState({ticket:t,policy:p,record:{
    first_response_due:r.first_response_due,resolution_due:r.resolution_due,
    first_response_at:r.first_response_at,resolved_at:r.resolved_at
   },now:at()});
  });
 }
 async function onStatusChanged(tx,{accountId,ticketId,previousStatus,nextStatus}){
  // Executed by synthetic router INSIDE its optimistic PATCH transaction.
  // Does not touch legacy jobs or customer messages.
  requireMailSandbox(env);
  const rows=await tx.query(ticketSql+" FOR UPDATE",[accountId,ticketId]);
  if(!rows.rows[0])notFound();
  const t=rows.rows[0],p=await policy(tx,accountId),now=at();
  const r=await ensureRecord(tx,t,p,now);
  if(previousStatus!=="waiting_customer"&&nextStatus==="waiting_customer"&&!r.paused_at){
   await tx.query("UPDATE support_sla_records SET paused_at=$3,updated_at=now() "+
    "WHERE account_id=$1 AND ticket_id=$2",[accountId,ticketId,now]);
  }else if(previousStatus==="waiting_customer"&&nextStatus!=="waiting_customer"&&r.paused_at){
   const pauseMinutes=businessMinutesBetween(r.paused_at,now,p);
   const due=pauseMinutes?addBusinessMinutes(r.resolution_due,pauseMinutes,p):asIso(r.resolution_due);
   await tx.query("UPDATE support_sla_records SET paused_at=NULL,resolution_due=$3,updated_at=now() "+
    "WHERE account_id=$1 AND ticket_id=$2",[accountId,ticketId,due]);
  }
  if(["resolved","closed"].includes(nextStatus)){
   await tx.query("UPDATE support_sla_records SET resolved_at=COALESCE(resolved_at,$3),updated_at=now() "+
    "WHERE account_id=$1 AND ticket_id=$2",[accountId,ticketId,now]);
  }else if(["resolved","closed"].includes(previousStatus)){
   await tx.query("UPDATE support_sla_records SET resolved_at=NULL,updated_at=now() "+
    "WHERE account_id=$1 AND ticket_id=$2",[accountId,ticketId]);
  }
 }
 async function policyInfo(accountId){
  ensureAccount(accountId);
  const rows=await db.query(CALENDAR_SQL,[accountId]);
  if(!rows.rows.length)throw new SupportError(422,"SLA_POLICY_UNCONFIGURED");
  return validateCalendar(rows.rows[0]);
 }
 async function evaluateRules({accountId,ticketId,actorId,caps}){
  requireMailSandbox(env);ensureAccount(accountId);
  if(!caps?.has("support.view.all"))throw new SupportError(403,"AUTOMATION_ADMIN_ONLY");
  return txRun(db,async tx=>{
   const t=await ticket(tx,accountId,ticketId);
   const p=await policy(tx,accountId),now=at();
   let r=await ensureRecord(tx,t,p,now);
   r=await applyResponse(tx,t,r);
   const checks=[
    ["critical_unassigned",t.priority==="critical"&&!t.assigned_to&&
       !["resolved","closed"].includes(t.status),"Unassigned critical synthetic ticket"],
    ["first_response_breach",!r.first_response_at&&now>r.first_response_due,
       "Synthetic first-response SLA breached"],
    ["resolution_breach",!r.resolved_at&&!r.paused_at&&now>r.resolution_due,
       "Synthetic resolution SLA breached"]
   ];
   const newRules=[];
   for(const [rule,triggered,body] of checks){
    if(!triggered)continue;
    const id=uuid();
    const claimed=await tx.query("INSERT INTO support_automation_receipts "+
     "(account_id,ticket_id,rule_id,id) VALUES($1,$2,$3,$4) "+
     "ON CONFLICT DO NOTHING RETURNING id",[accountId,ticketId,rule,id]);
    if(!claimed.rows.length)continue;
    await tx.query("INSERT INTO support_synthetic_alerts(id,account_id,ticket_id,rule_id,body) "+
      "VALUES($1,$2,$3,$4,$5)",[id,accountId,ticketId,rule,body]);
    newRules.push(rule);
   }
   return {newRules,source:"synthetic",notificationsSent:0};
  });
 }
 async function alerts({accountId,ticketId,actorId,caps}){
  requireMailSandbox(env);ensureAccount(accountId);
  const t=(await db.query(ticketSql,[accountId,ticketId])).rows[0];
  protectTicket(t,actorId,caps);
  return (await db.query("SELECT id,rule_id AS \"ruleId\",body,created_at AS \"createdAt\" "+
   "FROM support_synthetic_alerts WHERE account_id=$1 AND ticket_id=$2 "+
   "ORDER BY created_at DESC,id DESC LIMIT 30",[accountId,ticketId])).rows;
 }
 async function heartbeat({accountId,ticketId,actorId,caps,mode,version}){
  requireMailSandbox(env);ensureAccount(accountId);
  if(!caps?.has("support.view"))throw new SupportError(403,"SUPPORT_FORBIDDEN");
  if(!["viewing","drafting"].includes(mode)||!Number.isInteger(version)||version<1)
   throw new SupportError(400,"INVALID_PRESENCE");
  return txRun(db,async tx=>{
   const t=await ticket(tx,accountId,ticketId);
   protectTicket(t,actorId,caps);
   if(t.version!==version)throw new SupportError(412,"STALE_TICKET");
   const row=await tx.query("INSERT INTO support_agent_presence "+
    "(account_id,ticket_id,actor_id,mode,ticket_version,expires_at) "+
    "VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id,ticket_id,actor_id) "+
    "DO UPDATE SET mode=EXCLUDED.mode,ticket_version=EXCLUDED.ticket_version,"+
    "expires_at=EXCLUDED.expires_at,updated_at=now() RETURNING expires_at",
    [accountId,ticketId,actorId,mode,version,new Date(at().getTime()+90000)]);
   return {mode,expiresAt:row.rows[0].expires_at,version};
  });
 }
 async function presence({accountId,ticketId,actorId,caps}){
  requireMailSandbox(env);ensureAccount(accountId);
  const t=(await db.query(ticketSql,[accountId,ticketId])).rows[0];
  protectTicket(t,actorId,caps);
  const r=await db.query("SELECT actor_id AS \"actorId\",mode,ticket_version AS \"ticketVersion\","+
   "expires_at AS \"expiresAt\" FROM support_agent_presence "+
   "WHERE account_id=$1 AND ticket_id=$2 AND expires_at>$3 ORDER BY actor_id LIMIT 20",
   [accountId,ticketId,at()]);
  return {agents:r.rows.filter(x=>x.actorId!==actorId),asOf:asIso(at()),
   currentTicketVersion:t.version};
 }
 return Object.freeze({readSla,onStatusChanged,policyInfo,evaluateRules,alerts,heartbeat,presence});
}
