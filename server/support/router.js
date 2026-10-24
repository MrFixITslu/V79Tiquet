import express from "express";
import crypto from "node:crypto";
import {SupportError,parseCreate,parsePatch,versionOf,keyOf,listArgs,
 makeCursor,readCursor,digest,nonblank,ensureObject,noExtraKeys,optionalId} from "./contracts.js";
import {requireIdentity,supportCapabilities,requireCapability} from "./permissions.js";

// This router is intentionally NOT mounted by the production app in Phase 1.
const FIELDS='id,account_id AS "accountId",subject,client_id AS "clientId",'+
 'status,priority,assigned_to AS "assignedTo",created_by AS "createdBy",version,created_at AS "createdAt",updated_at AS "updatedAt"';
const MSG='id,ticket_id AS "ticketId",actor_id AS "actorId",visibility,channel,direction,'+
 'delivery_state AS "deliveryState",body,created_at AS "createdAt"';
const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(e=>{
 if(e instanceof SupportError) return res.status(e.status).json({code:e.code,error:e.message});
 return res.status(503).json({code:"SUPPORT_UNAVAILABLE",error:"Support Desk unavailable"});
});
const trans=(db,fn)=>db.transaction(fn)();
function canSee(req,row){
 return req.supportCaps.has("support.view.all")||row.assignedTo===req.user.id||row.createdBy===req.user.id;
}
function checkTicketAccess(req,row){
 if(!canSee(req,row)) throw new SupportError(404,"TICKET_NOT_FOUND");
}
async function getTicket(db,req,id){
 const rows=await db.query('SELECT '+FIELDS+' FROM support_tickets WHERE account_id=$1 AND id=$2',[req.accountId,id]);
 if(!rows.rows[0]) throw new SupportError(404,"TICKET_NOT_FOUND");
 checkTicketAccess(req,rows.rows[0]);
 return rows.rows[0];
}
async function existsIn(tx,table,account,id){
 if(!id) return;
 const found=await tx.query('SELECT id FROM '+table+' WHERE account_id=$1 AND id=$2',[account,id]);
 if(!found.rows.length) throw new SupportError(400,"INVALID_LINKED_RECORD");
}
async function audit(tx,account,ticket,actor,event,details={}){
 await tx.query('INSERT INTO support_events(id,account_id,ticket_id,actor_id,event_type,details) '+
 'VALUES($1,$2,$3,$4,$5,$6::jsonb)',
 [crypto.randomUUID(),account,ticket,actor,event,JSON.stringify(details)]);
}
export function createSupportRouter({db,authenticateToken}){
 if(!db?.query||!db?.transaction||typeof authenticateToken!=="function")
  throw new Error("Support Desk requires injected database and authentication");
 const router=express.Router();
 router.use(authenticateToken);
 router.use(wrap(async(req,res,next)=>{
  res.set("Cache-Control","no-store");
  requireIdentity(req);
  const found=await db.query('SELECT role,permissions FROM users WHERE id=$1 AND account_id=$2',
   [req.user.id,req.accountId]);
  if(!found.rows[0]) throw new SupportError(401,"SUPPORT_UNAUTHENTICATED");
  req.supportCaps=supportCapabilities(found.rows[0]);
  next();
 }));
 router.get("/tickets",wrap(async(req,res)=>{
  requireCapability(req,"support.view");
  const filter=listArgs(req.query);
  const cursor=readCursor(req.query.cursor,filter),args=[req.accountId];
  let where='account_id=$1';
  if(!req.supportCaps.has("support.view.all")){
   args.push(req.user.id);
   where+=' AND (assigned_to=$'+args.length+' OR created_by=$'+args.length+')';
  }
  for(const [field,val] of [["status",filter.status],["priority",filter.priority],
                              ["assigned_to",filter.assignedTo]]){
   if(val){args.push(val);where+=' AND '+field+'=$'+args.length;}
  }
  if(filter.search){args.push(filter.search);
   where+=' AND POSITION(LOWER($'+args.length+') IN LOWER(subject))>0';}
  if(cursor){args.push(cursor.at,cursor.id);
   where+=' AND (updated_at,id)<($'+(args.length-1)+'::timestamptz,$'+args.length+')';}
  args.push(filter.limit+1);
  const result=await db.query('SELECT '+FIELDS+' FROM support_tickets WHERE '+where+
   ' ORDER BY updated_at DESC,id DESC LIMIT $'+args.length,args);
  const more=result.rows.length>filter.limit;
  const items=result.rows.slice(0,filter.limit);
  res.json({items,nextCursor:more?makeCursor(items[items.length-1],filter):null});
 }));
 router.post("/tickets",wrap(async(req,res)=>{
  requireCapability(req,"support.create");
  const data=parseCreate(req.body),key=keyOf(req.headers),hash=digest(data);
  const account=req.accountId,actor=req.user.id,id=crypto.randomUUID();
  const result=await trans(db,async tx=>{
   await existsIn(tx,"clients",account,data.clientId);
   await existsIn(tx,"users",account,data.assignedTo);
   const claim=await tx.query('INSERT INTO support_ticket_requests '+
    '(account_id,actor_id,idem_key,body_hash,ticket_id) VALUES($1,$2,$3,$4,$5) '+
    'ON CONFLICT DO NOTHING RETURNING ticket_id',[account,actor,key,hash,id]);
   if(!claim.rows.length){
    const old=await tx.query('SELECT body_hash,ticket_id FROM support_ticket_requests '+
      'WHERE account_id=$1 AND actor_id=$2 AND idem_key=$3',[account,actor,key]);
    if(!old.rows[0]||old.rows[0].body_hash!==hash)
     throw new SupportError(409,"IDEMPOTENCY_CONFLICT");
    const row=(await tx.query('SELECT '+FIELDS+' FROM support_tickets WHERE account_id=$1 AND id=$2',
      [account,old.rows[0].ticket_id])).rows[0];
    if(!row) throw new SupportError(503,"IDEMPOTENCY_INCONSISTENT");
    return {row,replay:true};
   }
   const row=(await tx.query('INSERT INTO support_tickets '+
    '(id,account_id,subject,client_id,priority,assigned_to,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) '+
    'RETURNING '+FIELDS,[id,account,data.subject,data.clientId,data.priority,data.assignedTo,actor])).rows[0];
   await audit(tx,account,id,actor,"ticket.created",{status:"new"});
   return {row,replay:false};
  });
  res.set("ETag",'"'+result.row.version+'"').status(result.replay?200:201).json(result.row);
 }));
 router.get("/tickets/:id",wrap(async(req,res)=>{
  requireCapability(req,"support.view");
  const row=await getTicket(db,req,req.params.id);
  res.set("ETag",'"'+row.version+'"').json(row);
 }));
 router.patch("/tickets/:id",wrap(async(req,res)=>{
  requireCapability(req,"support.update");
  const version=versionOf(req.headers["if-match"]);
  const row=await trans(db,async tx=>{
   const found=await tx.query('SELECT '+FIELDS+
    ' FROM support_tickets WHERE account_id=$1 AND id=$2 FOR UPDATE',[req.accountId,req.params.id]);
   if(!found.rows[0]) throw new SupportError(404,"TICKET_NOT_FOUND");
   const previous=found.rows[0];
   checkTicketAccess(req,previous);
   if(previous.version!==version) throw new SupportError(412,"STALE_TICKET");
   const patch=parsePatch(req.body,previous.status),next={...previous,...patch};
   if("assignedTo" in patch) await existsIn(tx,"users",req.accountId,patch.assignedTo);
   const updated=await tx.query('UPDATE support_tickets SET subject=$3,status=$4,priority=$5,'+
     'assigned_to=$6,version=version+1,updated_at=now() WHERE account_id=$1 AND id=$2 '+
     'RETURNING '+FIELDS,
     [req.accountId,req.params.id,next.subject,next.status,next.priority,next.assignedTo]);
   await audit(tx,req.accountId,req.params.id,req.user.id,"ticket.updated",
     {fields:Object.keys(patch),oldStatus:previous.status,newStatus:next.status});
   return updated.rows[0];
  });
  res.set("ETag",'"'+row.version+'"').json(row);
 }));
 router.get("/tickets/:id/messages",wrap(async(req,res)=>{
  requireCapability(req,"support.view");
  await getTicket(db,req,req.params.id);
  const limit=req.query.limit===undefined?25:Number(req.query.limit);
  if(!Number.isInteger(limit)||limit<1||limit>100) throw new SupportError(400,"INVALID_LIMIT");
  if(req.query.cursor!==undefined) throw new SupportError(400,"CURSOR_NOT_READY");
  let where="account_id=$1 AND ticket_id=$2";
  if(!req.supportCaps.has("support.note")) where+=" AND visibility='public'";
  const rows=await db.query('SELECT '+MSG+' FROM support_messages WHERE '+where+
   ' ORDER BY created_at DESC,id DESC LIMIT $3',[req.accountId,req.params.id,limit]);
  res.json({items:rows.rows,nextCursor:null});
 }));
 router.post("/tickets/:id/messages",wrap(async(req,res)=>{
  requireCapability(req,"support.note");
  const b=ensureObject(req.body);noExtraKeys(b,["body","visibility"]);
  if(b.visibility!=="internal") throw new SupportError(409,"OUTBOUND_NOT_ENABLED");
  const body=nonblank(b.body,10000),key=keyOf(req.headers);
  const hash=digest({body,visibility:"internal"});
  const result=await trans(db,async tx=>{
   const found=await tx.query('SELECT '+FIELDS+' FROM support_tickets WHERE account_id=$1 AND id=$2 FOR UPDATE',
    [req.accountId,req.params.id]);
   if(!found.rows[0]) throw new SupportError(404,"TICKET_NOT_FOUND");
   checkTicketAccess(req,found.rows[0]);
   const id=crypto.randomUUID();
   const created=await tx.query('INSERT INTO support_messages '+
    '(id,account_id,ticket_id,actor_id,visibility,channel,direction,delivery_state,body,idem_key,body_hash) '+
    "VALUES($1,$2,$3,$4,'internal','manual','internal','not_applicable',$5,$6,$7) "+
    'ON CONFLICT DO NOTHING RETURNING '+MSG,
    [id,req.accountId,req.params.id,req.user.id,body,key,hash]);
   if(created.rows[0]){
    await audit(tx,req.accountId,req.params.id,req.user.id,"message.internal_created",{messageId:id});
    return {row:created.rows[0],replay:false};
   }
   const old=await tx.query('SELECT '+MSG+',body_hash AS "bodyHash" FROM support_messages '+
    'WHERE account_id=$1 AND ticket_id=$2 AND actor_id=$3 AND idem_key=$4',
    [req.accountId,req.params.id,req.user.id,key]);
   if(!old.rows[0]||old.rows[0].bodyHash!==hash)
    throw new SupportError(409,"IDEMPOTENCY_CONFLICT");
   const {bodyHash,...row}=old.rows[0];return {row,replay:true};
  });
  res.status(result.replay?200:201).json(result.row);
 }));
 router.post("/tickets/:id/links",wrap(async(req,res)=>{
  requireCapability(req,"support.link");
  const body=ensureObject(req.body);noExtraKeys(body,["kind","targetId"]);
  if(body.kind!=="service_job") throw new SupportError(400,"UNSUPPORTED_LINK");
  const jobId=optionalId(body.targetId);
  if(!jobId) throw new SupportError(400,"INVALID_ID");
  const created=await trans(db,async tx=>{
   const t=await tx.query('SELECT '+FIELDS+' FROM support_tickets WHERE account_id=$1 AND id=$2',
    [req.accountId,req.params.id]);
   if(!t.rows[0]) throw new SupportError(404,"TICKET_NOT_FOUND");
   checkTicketAccess(req,t.rows[0]);
   await existsIn(tx,"jobs",req.accountId,jobId);
   const result=await tx.query('INSERT INTO support_ticket_links(account_id,ticket_id,job_id,created_by) '+
    'VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING job_id',
    [req.accountId,req.params.id,jobId,req.user.id]);
   if(result.rows[0]) await audit(tx,req.accountId,req.params.id,req.user.id,
    "ticket.job_linked",{jobId});
   return Boolean(result.rows[0]);
  });
  res.status(created?201:200).json({kind:"service_job",targetId:jobId,created});
 }));
 return router;
}
