// Phase 6: test-only representation of the EXISTING Hub/Tiquet trust chain.
// No client-provided role or tenant may grant access. Not wired to production.
import {SupportError} from "./contracts.js";
import {requireMailSandbox} from "./mailContracts.js";

export const HUB_SUPPORT_GRANTS=Object.freeze({
 owner:{role:"Admin",permissions:[]},
 manager:{role:"Member",permissions:["support.view","support.view.all","support.create","support.update","support.note","support.link"]},
 staff:{role:"Member",permissions:["support.view","support.create","support.update","support.note","support.link"]},
 viewer:{role:"Member",permissions:["support.view"]}
});
export function grantsForHubRole(role){
 const granted=HUB_SUPPORT_GRANTS[role];
 if(!granted)throw new SupportError(403,"HUB_ROLE_UNSUPPORTED");
 return {role:granted.role,permissions:[...granted.permissions]};
}
export function createSyntheticHubRoleResolver({db,env=process.env}){
 requireMailSandbox(env);
 if(typeof db?.query!=="function")throw new Error("PHASE6_DB_REQUIRED");
 return async req=>{
  requireMailSandbox(env);
  if(!req?.user?.id||!req?.accountId)
   throw new SupportError(401,"SUPPORT_UNAUTHENTICATED");
  const rows=await db.query(
   "SELECT m.hub_role, m.hub_organization_id, c.hub_organization_id AS account_hub_org,"+
   "m.hub_user_id,c.status FROM support_hub_memberships m "+
   "JOIN support_hub_context c ON c.account_id=m.account_id "+
   "WHERE m.account_id=$1 AND m.user_id=$2",
   [req.accountId,req.user.id]);
  const membership=rows.rows[0];
  // Sessions are already verified by the existing Hub-aware middleware,
  // but re-read roles/account links on EVERY request to avoid stale grants.
  if(!membership||membership.status!=="active"||!membership.hub_user_id||
   !membership.account_hub_org||
   membership.hub_organization_id!==membership.account_hub_org||
   req.user.hub_organization_id!==membership.account_hub_org)
   throw new SupportError(403,"HUB_SUPPORT_SCOPE_DENIED");
  return grantsForHubRole(membership.hub_role);
 };
}
