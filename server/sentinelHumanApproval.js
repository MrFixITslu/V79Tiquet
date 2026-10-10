// Independently signed human-approval gate for one exact, verified Sentinel ticket.
// The Tiquet receiver stores PUBLIC verification keys only. No private signer here.
import crypto from "node:crypto";

const ID=/^[a-z][a-z0-9_.:-]{2,127}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=(message,status=403)=>Object.assign(new Error(message),{status});
const sha256=data=>crypto.createHash("sha256").update(data).digest("hex");
const isoTime=text=>{
  if(typeof text!=="string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(text))
    return NaN;
  return Date.parse(text);
};

export function approvalCanonical(approval){
  // Array of explicitly ordered primitive claims. Never sign an arbitrary JSON object.
  return Buffer.from(JSON.stringify([
    "v79-sentinel-ticket-approval-v1",approval.key_id,approval.approval_id,
    approval.approver_user_id,approval.mfa_verified_at,approval.approved_at,
    approval.expires_at,approval.event_sha256,approval.event_id,approval.incident_id,
    approval.sentinel_customer_id,approval.tiquet_organization_id,
    approval.tiquet_client_id,approval.decision
  ]),"utf8");
}

export function approvalEventDigest(event){
  const clean={...event};
  delete clean.approval;
  return sha256(JSON.stringify(clean));
}

export function parseApprovalPublicKeys(keys){
  if(!Array.isArray(keys) || keys.length===0 || keys.length>8)
    throw new Error("No trusted human-approval public keys configured");
  const known=new Set();
  return keys.map(item=>{
    if(!item || !ID.test(item.keyId || "") || typeof item.publicKeyPem!=="string" ||
        !/^-----BEGIN PUBLIC KEY-----\n/.test(item.publicKeyPem) ||
        item.enabled!==true || known.has(item.keyId))
      throw new Error("Invalid human-approval key list");
    const key=crypto.createPublicKey(item.publicKeyPem);
    if(key.type!=="public" || key.asymmetricKeyType!=="ed25519")
      throw new Error("Only public Ed25519 approval keys are accepted");
    known.add(item.keyId);
    return Object.freeze({keyId:item.keyId,key});
  });
}

export function verifyHumanTicketApproval(event,keys,nowMs=Date.now()){
  if(event?.action!=="ticket.create") return null;
  if(!Array.isArray(keys) || keys.length===0) throw deny("Approval verification unavailable",503);
  const proof=event.approval;
  if(!proof || typeof proof!=="object" || Array.isArray(proof) ||
    !UUID.test(proof.approval_id || "") || !ID.test(proof.approver_user_id || "") ||
    !ID.test(proof.key_id || "") || proof.decision!=="approve_ticket_create" ||
    !/^[a-f0-9]{64}$/.test(proof.event_sha256 || "") ||
    !/^[A-Za-z0-9_-]{86}$/.test(proof.signature || ""))
    throw deny("Valid operator approval required");
  if(proof.event_id!==event.event_id || proof.incident_id!==event.source_incident_id ||
     proof.sentinel_customer_id!==event.tenant.sentinel_customer_id ||
     proof.tiquet_organization_id!==event.tenant.tiquet_organization_id ||
     proof.tiquet_client_id!==event.tenant.tiquet_client_id ||
     proof.event_sha256!==approvalEventDigest(event))
    throw deny("Approval is not bound to the exact incident and tenant");
  const mfa=isoTime(proof.mfa_verified_at),approved=isoTime(proof.approved_at),
        expires=isoTime(proof.expires_at);
  if(![mfa,approved,expires].every(Number.isFinite) ||
     approved<mfa || approved-mfa>15*60_000 ||
     expires<=approved || expires-approved>15*60_000 ||
     nowMs<approved-30_000 || nowMs>=expires)
    throw deny("Expired or unverified MFA approval");
  const trusted=keys.find(item=>item.keyId===proof.key_id);
  if(!trusted) throw deny("Unknown or revoked approval key");
  const signature=Buffer.from(proof.signature,"base64url");
  if(signature.length!==64 ||
     !crypto.verify(null,approvalCanonical(proof),trusted.key,signature))
    throw deny("Invalid independent approval signature");
  return Object.freeze({
    approvalId:proof.approval_id,approverUserId:proof.approver_user_id,
    approvedAt:proof.approved_at,eventSha256:proof.event_sha256,keyId:proof.key_id
  });
}
