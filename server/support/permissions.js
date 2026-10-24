import {SupportError} from "./contracts.js";
// Hub entitlement/session verification happens before this module.
const allowed=["support.view","support.view.all","support.create","support.update","support.note","support.reply","support.link"];
export function supportCapabilities(user){
 if(user?.role==="Admin") return new Set(allowed);
 let perms=user?.permissions??[];
 if(typeof perms==="string"){
  try{perms=JSON.parse(perms);}catch{perms=[];}
 }
 if(!Array.isArray(perms)) return new Set();
 return new Set(perms.filter(p=>typeof p==="string"&&allowed.includes(p)));
}
export function requireCapability(req,permission){
 if(!req.supportCaps?.has(permission)) throw new SupportError(403,"SUPPORT_FORBIDDEN");
}
export function requireIdentity(req){
 if(typeof req.accountId!=="string"||!req.accountId||!req.user?.id)
  throw new SupportError(401,"SUPPORT_UNAUTHENTICATED");
}
