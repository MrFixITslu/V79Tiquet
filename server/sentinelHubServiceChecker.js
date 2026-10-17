// Machine-to-machine Sentinel entitlement check against the owner Hub.
// Never use a human JWT/session as a fallback and never accept a redirect.
import crypto from "node:crypto";

const ENDPOINT="/api/platform/sentinel/service/check";
const sha256=x=>crypto.createHash("sha256").update(x).digest("hex");

export function createSentinelHubServiceChecker({
  hubUrl,secret,transport=fetch,now=Date.now,allowLoopbackTesting=false
}){
  if(typeof secret!=="string" || secret.length<48)
    throw new Error("Dedicated Hub Sentinel machine identity not configured");
  const url=new URL(hubUrl);
  if(url.username || url.password || url.search || url.hash ||
     url.pathname!=="/")
    throw new Error("Hub machine service URL must be an origin only");
  const localhost=(url.hostname==="127.0.0.1" || url.hostname==="localhost");
  if(url.protocol!=="https:" && !(allowLoopbackTesting &&
      process.env.NODE_ENV!=="production" && localhost && url.protocol==="http:"))
    throw new Error("Hub Sentinel machine check requires HTTPS");
  url.pathname=ENDPOINT;
  const endpoint=url.toString();
  return async ({serviceId,sentinelCustomerId,organizationId,accountId,clientId,action})=>{
    if(serviceId!=="v79-sentinel" || ![sentinelCustomerId,organizationId,accountId,clientId,action]
       .every(x=>typeof x==="string" && x.length>0 && x.length<=180)) return false;
    const body=JSON.stringify({serviceId,sentinelCustomerId,organizationId,accountId,clientId,action});
    const timestamp=String(now());
    const canonical=["POST",ENDPOINT,timestamp,sha256(body)].join("\n");
    const signature=crypto.createHmac("sha256",secret).update(canonical).digest("hex");
    try{
      const response=await transport(endpoint,{
        method:"POST",body,redirect:"error",
        headers:{"content-type":"application/json","x-v79-service-id":"v79-tiquet",
          "x-v79-timestamp":timestamp,"x-v79-signature":signature},
        signal:AbortSignal.timeout(3500),
      });
      if(!response.ok || response.redirected || (response.url && response.url!==endpoint) ||
        !String(response.headers?.get?.("content-type") || "").toLowerCase().includes("application/json"))
        return false;
      const text=await response.text();
      if(typeof text!=="string" || text.length>1024) return false;
      const verdict=JSON.parse(text);
      return verdict?.allowed===true && Number.isInteger(verdict.validForSeconds) &&
        verdict.validForSeconds>=1 && verdict.validForSeconds<=5;
    }catch{
      return false;
    }
  };
}
