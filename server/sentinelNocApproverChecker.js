// Dedicated machine-only V79Tiquet -> NOC live human-approver revalidation.
// Default OFF; no human sessions, browser cookies, redirects, or HTTP fallback.
import crypto from "node:crypto";

export const NOC_APPROVER_PATH="/api/v1/sentinel/service/approver/check";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=x=>crypto.createHash("sha256").update(x).digest("hex");

export function createSentinelNocApproverChecker({
  nocUrl,secret,transport=fetch,now=Date.now,allowLoopbackTesting=false
}={}){
  if(typeof secret!=="string" || Buffer.byteLength(secret,"utf8")<48)
    throw new Error("Dedicated Sentinel NOC reviewer-service secret missing");
  const origin=new URL(nocUrl);
  if(origin.username || origin.password || origin.search || origin.hash ||
     origin.pathname!=="/")
    throw new Error("NOC reviewer URL must be an origin");
  const local=origin.hostname==="127.0.0.1" || origin.hostname==="localhost";
  if(origin.protocol!=="https:" && !(allowLoopbackTesting &&
      process.env.NODE_ENV!=="production" && local && origin.protocol==="http:"))
    throw new Error("NOC reviewer checks require HTTPS");
  origin.pathname=NOC_APPROVER_PATH;
  const endpoint=origin.toString();
  return async function checkCurrentApprover(scope){
    if(!scope || typeof scope!=="object" || Array.isArray(scope) ||
       Object.keys(scope).length!==6 ||
       !["approverUserId","approvalId","organizationId","sentinelCustomerId"]
          .every(k=>ID.test(scope[k]||"")) ||
       typeof scope.approvedAt!=="string" ||
       !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(scope.approvedAt) ||
       scope.action!=="ticket.create") return false;
    const body=JSON.stringify({
      approverUserId:scope.approverUserId,approvalId:scope.approvalId,
      approvedAt:scope.approvedAt,organizationId:scope.organizationId,
      sentinelCustomerId:scope.sentinelCustomerId,action:scope.action
    });
    const stamp=String(Math.floor(now()/1000));
    const signature=crypto.createHmac("sha256",secret)
      .update(["POST",NOC_APPROVER_PATH,stamp,hash(body)].join("\n"))
      .digest("hex");
    try{
      const response=await transport(endpoint,{
        method:"POST",body,redirect:"error",signal:AbortSignal.timeout(3500),
        headers:{"content-type":"application/json","x-v79-service-id":"v79-tiquet",
          "x-v79-timestamp":stamp,"x-v79-signature":signature}
      });
      if(!response.ok || response.redirected || (response.url && response.url!==endpoint) ||
         !String(response.headers?.get?.("content-type")||"").toLowerCase().includes("application/json"))
        return false;
      const answer=await response.text();
      if(answer.length>1024) return false;
      const result=JSON.parse(answer);
      return result?.allowed===true && Number.isInteger(result.validForSeconds) &&
        result.validForSeconds>=1 && result.validForSeconds<=5;
    }catch{return false;}
  };
}
