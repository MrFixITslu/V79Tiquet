// Runs production Tiquet's signed session and Hub-entitlement middleware
// unchanged against a strictly synthetic, local PostgreSQL compatibility shim.
// No outbound HTTP, real Hub API, production secret, or header-derived roles.
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import jwt from "jsonwebtoken";
import {createTiquetAuthentication} from "../hubAwareAuthentication.js";
import {createHubEntitlementChecker} from "../hubEntitlementRevalidation.js";
import {createSyntheticHubRoleResolver} from "./phase6HubPolicy.js";
import {requireMailSandbox} from "./mailContracts.js";
import {tokenFingerprint} from "../tokenRevocation.js";

function authAdapter(db){
 return {prepare:(sql)=>{
  const statement=sql.replace(/\s+/g," ").trim();
  if(statement==="SELECT token_hash FROM revoked_auth_tokens WHERE token_hash = ? AND expires_at > ?")
   return {get:async(hash,when)=>(await db.query(
    "SELECT token_hash FROM support_hub_revoked_sessions WHERE token_hash=$1 AND expires_at>$2",
    [hash,when])).rows[0]};
  if(statement==="SELECT id, hub_user_id FROM users WHERE id = ? AND account_id = ?")
   return {get:async(user,account)=>(await db.query(
    "SELECT u.id,m.hub_user_id FROM users u JOIN support_hub_memberships m "+
    "ON m.account_id=u.account_id AND m.user_id=u.id "+
    "WHERE u.id=$1 AND u.account_id=$2",
    [user,account])).rows[0]};
  if(statement==="SELECT status, hub_organization_id FROM accounts WHERE id = ?")
   return {get:async(account)=>(await db.query(
    "SELECT status,hub_organization_id FROM support_hub_context WHERE account_id=$1",
    [account])).rows[0]};
  throw Error("PHASE6_AUTH_ADAPTER_SQL_NOT_ALLOWED");
 }};
}
const same=(a,b)=>{
 const left=Buffer.from(String(a||"")),right=Buffer.from(String(b||""));
 return left.length===right.length&&timingSafeEqual(left,right);
};
export function createPhase6SyntheticHubAuth({
 db,secret,signatureSecret,entitlements,clock,env=process.env,
 hubUrl="http://127.0.0.1:4099",httpTransport=null
}){
 requireMailSandbox(env);
 if(!db?.query||typeof secret!=="string"||secret.length<40||
  typeof signatureSecret!=="string"||signatureSecret.length<40||
  !(entitlements instanceof Map)||typeof clock!=="function")
  throw Error("PHASE6_MOCK_TRUST_INPUT_REQUIRED");
 let hubCalls=0;
 const target=new URL(hubUrl);
 if(target.protocol!=="http:"||target.hostname!=="127.0.0.1"||
    target.username||target.password||target.pathname!=="/"||!target.port||
    (httpTransport!==null&&typeof httpTransport!=="function"))
  throw Error("PHASE7_LOCAL_HUB_ONLY");
 const checker=createHubEntitlementChecker({
  product:"tiquet",hubUrl,secret:signatureSecret,now:clock,
  transport:httpTransport??(async(uri,options)=>{
   // Not a network call. Verify the *real* HMAC request emitted by the
   // production checker before returning synthetic entitlement decisions.
   hubCalls++;
   const url=new URL(uri);
   if(url.origin!==hubUrl||url.pathname!=="/api/platform/entitlement/check"||
     options.method!=="POST")throw Error("SYNTHETIC_HUB_URL_UNEXPECTED");
   const body=JSON.parse(options.body);
   const hash=createHash("sha256").update(options.body).digest("hex");
   const canonical=["POST",url.pathname,options.headers["x-v79-timestamp"],hash].join("\n");
   const signature=createHmac("sha256",signatureSecret).update(canonical).digest("hex");
   if(!same(signature,options.headers["x-v79-signature"])||
      options.headers["x-v79-service-id"]!=="v79-tiquet"||
      body.product!=="tiquet")
    throw Error("SYNTHETIC_HUB_SIGNATURE_DENIED");
   const allowed=entitlements.get(body.organizationId+":"+body.scopedUserId)===true;
   return new Response(JSON.stringify({allowed,validForSeconds:1}),{
    status:200,headers:{"content-type":"application/json"}
   });
  })
 });
 // Synthetic purpose pinning *in addition to* production JWT verification.
 const verifyJwt={
  verify:(token,key,callback)=>jwt.verify(token,key,{
   issuer:"tiquet-phase6-synthetic",
   audience:"tiquet-support-sandbox",
   algorithms:["HS256"]
  },callback)
 };
 const productionAuth=createTiquetAuthentication({
  jwt:verifyJwt,jwtSecret:secret,db:authAdapter(db),checkHubSubscription:checker
 });
 const resolveCapabilities=createSyntheticHubRoleResolver({db,env});
 const issue=({id,accountId,org,expiresIn="15m",roleClaim})=>{
  // roleClaim intentionally ignored by the resolver, even if forged in JWT.
  return jwt.sign({id,account_id:accountId,hub_organization_id:org,
   hub_managed:true,role:roleClaim||"Admin"},
  secret,{algorithm:"HS256",issuer:"tiquet-phase6-synthetic",
   audience:"tiquet-support-sandbox",expiresIn});
 };
 const revoke=async({token,accountId})=>{
  await db.query(
   "INSERT INTO support_hub_revoked_sessions(token_hash,account_id,expires_at) "+
   "VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
   [tokenFingerprint(token),accountId,jwt.decode(token)?.exp||0]);
 };
 return Object.freeze({authenticateToken:productionAuth,resolveCapabilities,
  issue,revoke,hubCalls:()=>hubCalls});
}
