import test from "node:test";
import assert from "node:assert/strict";
import { hubManagedMapping } from "../server/hubManagedLink.js";
test("complete verified Hub linkage is valid",()=>{
  assert.deepEqual(hubManagedMapping({accountOrganizationId:"org-a",linkedUserId:"user-a",tokenOrganizationId:"org-a",tokenHubManaged:true}),{managed:true,valid:true});
});
test("cross-tenant JWT claim never validates",()=>{
  assert.equal(hubManagedMapping({accountOrganizationId:"org-a",linkedUserId:"user-a",tokenOrganizationId:"org-b",tokenHubManaged:true}).valid,false);
});
test("incomplete account or user links are rejected",()=>{
  assert.equal(hubManagedMapping({accountOrganizationId:"org-a",linkedUserId:null}).valid,false);
  assert.equal(hubManagedMapping({accountOrganizationId:null,linkedUserId:"user-a"}).valid,false);
  assert.equal(hubManagedMapping({tokenHubManaged:true}).valid,false);
});
test("legacy unlinked account can be distinguished from Hub-managed identity",()=>{
  assert.deepEqual(hubManagedMapping({}),{managed:false,valid:false});
});
