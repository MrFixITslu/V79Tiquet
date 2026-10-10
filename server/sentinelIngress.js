// V79 Sentinel -> V79Tiquet service ingestion (opt-in, disabled by default).
// No interactive user JWT, portal credential, email, invoicing or payment side effects.
import crypto from "node:crypto";
import express from "express";
import { parseApprovalPublicKeys, verifyHumanTicketApproval } from "./sentinelHumanApproval.js";

export const SENTINEL_PATH="/api/integrations/sentinel/v1/events";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const isUuid=value=>typeof value==="string" && UUID.test(value);
const validId=value=>typeof value==="string" && OPAQUE.test(value);
const sha256=value=>crypto.createHash("sha256").update(value).digest("hex");
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const validText=(value,max)=>typeof value==="string" && value.length>0 && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);

export function parseSentinelLinks(input) {
  if (!Array.isArray(input) || !input.length || input.length>50) throw new Error("Invalid Sentinel mapping configuration");
  const ids=new Set(),accounts=new Set(),secrets=new Set();
  return input.map(link=>{
    if (!link || typeof link!=="object" || !isUuid(link.sentinelCustomerId) ||
        !validId(link.tiquetOrganizationId) || !validId(link.tiquetAccountId) ||
        !validId(link.tiquetClientId) || typeof link.secret!=="string" ||
        Buffer.byteLength(link.secret)<48 || typeof link.enabled!=="boolean") throw new Error("Invalid Sentinel mapping configuration");
    if (ids.has(link.sentinelCustomerId) || accounts.has(link.tiquetAccountId) || secrets.has(link.secret))
      throw new Error("Duplicate Sentinel mapping configuration");
    ids.add(link.sentinelCustomerId);accounts.add(link.tiquetAccountId);secrets.add(link.secret);
    return Object.freeze({...link});
  });
}

export function sentinelConfigFromEnv(env=process.env){
  if (env.V79_SENTINEL_INGEST_ENABLED!=="1") return {enabled:false,links:[]};
  if (!env.V79_SENTINEL_LINKS_JSON) throw new Error("Enabled Sentinel integration requires explicit tenant mappings");
  return {enabled:true,links:parseSentinelLinks(JSON.parse(env.V79_SENTINEL_LINKS_JSON)),
    approvalKeys:env.V79_SENTINEL_APPROVAL_PUBLIC_KEYS_JSON?
      JSON.parse(env.V79_SENTINEL_APPROVAL_PUBLIC_KEYS_JSON):[]};
}

export function validateSentinelEvent(event,link){
  if (!event || Array.isArray(event) || typeof event!=="object" ||
      event.schema_version!==1 || event.source!=="v79-sentinel" ||
      event.classification!=="PRODUCTION_VERIFIED" ||
      !isUuid(event.event_id) || !isUuid(event.source_incident_id) ||
      event.idempotency_key!=="sentinel:event:"+event.event_id ||
      event.correlation_key!=="sentinel:incident:"+event.source_incident_id)
    throw bad("Unverified Sentinel event");
  if (!event.tenant || event.tenant.sentinel_customer_id!==link.sentinelCustomerId ||
      event.tenant.tiquet_organization_id!==link.tiquetOrganizationId ||
      event.tenant.tiquet_client_id!==link.tiquetClientId)
    throw bad("Tenant mapping mismatch",403);
  if (!event.impact || !isUuid(event.impact.site_id) ||
      !validText(event.impact.site_name,150) || !validText(event.impact.failure_domain,100))
    throw bad("Invalid incident site");
  if (!event.incident || !validText(event.incident.title,220) ||
      !["warning","critical"].includes(event.incident.severity) ||
      typeof event.incident.detected_at!=="string" ||
      !Number.isFinite(Date.parse(event.incident.detected_at))) throw bad("Invalid incident details");
  if (event.action==="ticket.create"){
    if (event.incident.observed_state!=="open" || event.recovery!==undefined) throw bad("Invalid opening event");
  } else if (event.action==="ticket.add_recovery_evidence"){
    if (event.incident.observed_state!=="resolved" ||
        event.recovery?.ticket_should_close!==false ||
        event.recovery?.requires_technician_verification!==true ||
        !Number.isFinite(Date.parse(event.recovery.observed_at))) throw bad("Invalid recovery evidence");
  } else throw bad("Unsupported ticket event");
  return event;
}

function authenticate(req,links,nowSeconds){
  if (req.headers.origin || req.headers.cookie || req.headers.authorization) throw bad("Browser credentials not accepted",403);
  if (req.get("x-v79-service-id")!=="v79-sentinel") throw bad("Service identity required",401);
  if (!Buffer.isBuffer(req.rawBody) || req.rawBody.length===0 || req.rawBody.length>12000) throw bad("Invalid signed request size",413);
  if (!req.is("application/json")) throw bad("JSON required",415);
  const customer=req.get("x-v79-sentinel-customer");
  const timestamp=req.get("x-v79-timestamp");
  const sig=req.get("x-v79-signature");
  if (!isUuid(customer) || !/^[0-9]{10,11}$/.test(timestamp||"") || !/^[a-f0-9]{64}$/.test(sig||""))
    throw bad("Invalid service signature",401);
  if (Math.abs(nowSeconds-Number(timestamp))>300) throw bad("Expired service signature",401);
  const link=links.find(x=>x.sentinelCustomerId===customer);
  if (!link || link.enabled!==true) throw bad("Unknown or revoked service identity",401);
  const canonical=["POST",SENTINEL_PATH,timestamp,sha256(req.rawBody)].join("\n");
  const expected=crypto.createHmac("sha256",link.secret).update(canonical).digest();
  const provided=Buffer.from(sig,"hex");
  if (provided.length!==expected.length || !crypto.timingSafeEqual(provided,expected))
    throw bad("Invalid service signature",401);
  return link;
}

export async function persistSentinelEvent(db,event,link,bodyDigest,approval=null,now=new Date().toISOString()){
  return db.transaction(async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtext(?))",["v79-sentinel:"+event.source_incident_id]);
    const account=(await tx.query("SELECT id,status,hub_organization_id FROM accounts WHERE id=?",[link.tiquetAccountId])).rows[0];
    if (!account || account.status!=="active" || account.hub_organization_id!==link.tiquetOrganizationId)
      throw bad("Unverified Tiquet account linkage",403);
    const client=(await tx.query("SELECT id,name FROM clients WHERE id=? AND account_id=?",[
      link.tiquetClientId,link.tiquetAccountId])).rows[0];
    if (!client || !validText(client.name,200)) throw bad("Unverified Tiquet client linkage",403);
    const priorEvent=(await tx.query("SELECT * FROM sentinel_ingest_events WHERE event_id=?",[event.event_id])).rows[0];
    if (priorEvent){
      if (priorEvent.body_sha256!==bodyDigest || priorEvent.account_id!==link.tiquetAccountId ||
          priorEvent.client_id!==link.tiquetClientId || priorEvent.source_incident_id!==event.source_incident_id ||
          priorEvent.action!==event.action) throw bad("Conflicting replay",409);
      return {state:"duplicate",jobId:priorEvent.job_id};
    }
    const prior=(await tx.query("SELECT * FROM sentinel_incident_jobs WHERE source_incident_id=?",[
      event.source_incident_id])).rows[0];
    if (prior && (prior.account_id!==link.tiquetAccountId || prior.client_id!==link.tiquetClientId))
      throw bad("Incident cannot change tenant",409);
    let jobId=prior?.job_id;
    let state;
    if (event.action==="ticket.create"){
      if (!approval) throw bad("Independent human approval missing",403);
      if (!prior){
        jobId=crypto.randomUUID();
        await tx.query("INSERT INTO jobs (id,title,client,description,status,createdAt,priority,clientId,account_id,secureToken,depositPaid,intakeEventId) VALUES (?,?,?,?,?,?,?,?,?,NULL,0,?)",[
          jobId,("[Sentinel] "+event.incident.title).slice(0,240),client.name,
          ("Verified Sentinel event "+event.source_incident_id+" at site "+event.impact.site_name+
           ". Domain: "+event.impact.failure_domain+". Human verification required.").slice(0,600),
          "request",now,event.incident.severity==="critical"?"high":"medium",link.tiquetClientId,
          link.tiquetAccountId,"sentinel:incident:"+event.source_incident_id]);
        await tx.query("INSERT INTO sentinel_incident_jobs (source_incident_id,account_id,client_id,job_id,opened_at) VALUES (?,?,?,?,?)",[
          event.source_incident_id,link.tiquetAccountId,link.tiquetClientId,jobId,now]);
        state="created";
      } else state="existing";
      // Audit proof is committed atomically with this incident and its job.
      await tx.query("INSERT INTO sentinel_ticket_approvals (approval_id,event_id,source_incident_id,account_id,client_id,job_id,approver_user_id,approval_key_id,evidence_sha256,approved_at,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[
        approval.approvalId,event.event_id,event.source_incident_id,link.tiquetAccountId,
        link.tiquetClientId,jobId,approval.approverUserId,approval.keyId,
        approval.eventSha256,approval.approvedAt,now]);
    } else {
      if (!prior) throw bad("Recovery before ticket creation",409);
      await tx.query("UPDATE sentinel_incident_jobs SET recovery_at=? WHERE source_incident_id=? AND account_id=?",[
        event.recovery.observed_at,event.source_incident_id,link.tiquetAccountId]);
      await tx.query("INSERT INTO activity_logs (id,job_id,action,timestamp,\"user\",account_id) VALUES (?,?,?,?,?,?)",[
        crypto.randomUUID(),jobId,"Sentinel reports verified recovery; technician must confirm and close",
        now,"V79 Sentinel",link.tiquetAccountId]);
      state="recovery_noted";
    }
    await tx.query("INSERT INTO sentinel_ingest_events (event_id,source_incident_id,account_id,client_id,action,body_sha256,job_id,processed_at) VALUES (?,?,?,?,?,?,?,?)",[
      event.event_id,event.source_incident_id,link.tiquetAccountId,link.tiquetClientId,
      event.action,bodyDigest,jobId,now]);
    return {state,jobId};
  })();
}

export function createSentinelIngestRouter({db,config,clock=()=>Math.floor(Date.now()/1000),authorizeService=null}){
  if (!db || typeof db.transaction!=="function") throw new TypeError("Transactional database required");
  const router=express.Router();
  const enabled=config?.enabled===true;
  const links=enabled?parseSentinelLinks(config.links):[];
  // Trusted verification keys come only from server configuration, never from a request.
  // Missing keys block ticket creation; runtime remains fail-closed by default.
  const approvalKeys=enabled && config.approvalKeys!=null?
    parseApprovalPublicKeys(config.approvalKeys):[];
  router.post("/",async(req,res)=>{
    if (!enabled) return res.status(404).json({error:"Not found"});
    try {
      if (process.env.NODE_ENV==="production" && !req.secure) throw bad("TLS required",403);
      const link=authenticate(req,links,clock());
      const event=validateSentinelEvent(req.body,link);
      // Mapping ownership does not establish an active Hub service entitlement.
      // No adapter is wired to the live Hub yet: fail closed even if the feature flag is set.
      if (typeof authorizeService!=="function") throw bad("Service entitlement authority unavailable",503);
      const allowed=await authorizeService({serviceId:"v79-sentinel",sentinelCustomerId:link.sentinelCustomerId,
        organizationId:link.tiquetOrganizationId,accountId:link.tiquetAccountId,
        clientId:link.tiquetClientId,action:event.action});
      if (allowed!==true) throw bad("Service entitlement denied",403);
      const approval=verifyHumanTicketApproval(event,approvalKeys,clock()*1000);
      const result=await persistSentinelEvent(db,event,link,sha256(req.rawBody),approval);
      return res.status(result.state==="created"?201:200).json({
        accepted:true,state:result.state,jobId:result.jobId,correlationKey:event.correlation_key
      });
    } catch (error) {
      const status=Number.isInteger(error.status)?error.status:503;
      return res.status(status).json({error:status===503?"Integration unavailable":"Event rejected"});
    }
  });
  return router;
}
