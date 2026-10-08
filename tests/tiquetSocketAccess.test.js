import test from "node:test";
import assert from "node:assert/strict";
import { authorizeTiquetStaffSocket, revalidateTiquetStaffSocket } from "../server/tiquetSocketAccess.js";

const now = Date.now();
const validUser={id:"user-a",account_id:"account-a",hub_organization_id:"org-a",hub_managed:true,exp:Math.ceil(now/1000)+600};
const db={
  users:{"account-a":{id:"user-a",hub_user_id:"scoped-a"}},
  accounts:{"account-a":{status:"active",hub_organization_id:"org-a"}},
  prepare(sql){
    return {async get(...args){
      if(sql.includes("FROM users")){
        const record=db.users[args[1]];
        return record?.id===args[0] ? record : undefined;
      }
      if(sql.includes("FROM accounts")) return db.accounts[args[0]];
      throw new Error("Unapproved query in staging fixture");
    }};
  },
};

test("staff websocket must pass live account and Hub entitlements",async()=>{
  const verified=[];
  const checker=async identity=>{
    verified.push(identity);return identity.organizationId==="org-a"&&identity.scopedUserId==="scoped-a";
  };
  const result=await authorizeTiquetStaffSocket({decoded:validUser,db,checkHubSubscription:checker});
  assert.equal(result.allowed,true);
  assert.deepEqual(result.hubIdentity,{organizationId:"org-a",scopedUserId:"scoped-a"});
  assert.equal(result.jwtExpiresAt,validUser.exp*1000);
  assert.equal(verified.length,1);
});
test("customer scope mismatch and revoked user deny websocket registration",async()=>{
  const checker=async()=>true;
  assert.equal((await authorizeTiquetStaffSocket({decoded:{...validUser,hub_organization_id:"org-b"},db,checkHubSubscription:checker})).allowed,false);
  db.users["account-a"].hub_user_id=null;
  assert.equal((await authorizeTiquetStaffSocket({decoded:validUser,db,checkHubSubscription:checker})).allowed,false);
  db.users["account-a"].hub_user_id="scoped-a";
  db.accounts["account-a"].status="suspended";
  assert.equal((await authorizeTiquetStaffSocket({decoded:validUser,db,checkHubSubscription:checker})).allowed,false);
  db.accounts["account-a"].status="active";
});
test("expired or malformed staff JWT cannot attach a chat socket",async()=>{
  const checker=async()=>true;
  for(const decoded of [{...validUser,exp:1},{...validUser,exp:null},{...validUser,account_id:"account-other"}]){
    assert.equal((await authorizeTiquetStaffSocket({decoded,db,checkHubSubscription:checker})).allowed,false);
  }
});
test("live heartbeat closes staff sockets after Hub cancellation or JWT expiry",async()=>{
  const ws={role:"staff",hubIdentity:{organizationId:"org-a",scopedUserId:"scoped-a"},jwtExpiresAt:Date.now()+60000};
  assert.equal(await revalidateTiquetStaffSocket(ws,async()=>true),true);
  assert.equal(await revalidateTiquetStaffSocket(ws,async()=>false),false);
  assert.equal(await revalidateTiquetStaffSocket(ws,async()=>{throw new Error("Hub offline")}),false);
  assert.equal(await revalidateTiquetStaffSocket({...ws,jwtExpiresAt:100},async()=>true),false);
});
test("portal sockets use their separate secure-link policy",async()=>{
  assert.equal(await revalidateTiquetStaffSocket({role:"client"},async()=>false),true);
});
