import test from "node:test";
import assert from "node:assert/strict";
import {parseCreate,parsePatch,keyOf,versionOf,listArgs,makeCursor,readCursor,SupportError} from "../server/support/contracts.js";
import {supportCapabilities} from "../server/support/permissions.js";
test("create rejects bad fields and normalizes valid data",()=>{
 assert.deepEqual(parseCreate({subject:"  Network unavailable  "}),
  {subject:"Network unavailable",clientId:null,priority:"normal",assignedTo:null});
 assert.throws(()=>parseCreate({subject:"ab"}),e=>e instanceof SupportError&&e.status===400);
 assert.throws(()=>parseCreate({subject:"Okay",accountId:"another-tenant"}),/UNKNOWN_FIELD/);
 assert.throws(()=>parseCreate({subject:"Okay",priority:"urgent"}),/INVALID_PRIORITY/);
});
test("status transitions and update validation are explicit",()=>{
 assert.deepEqual(parsePatch({status:"open"},"new"),{status:"open"});
 assert.throws(()=>parsePatch({status:"waiting_customer"},"closed"),/INVALID_TRANSITION/);
 assert.throws(()=>parsePatch({}),/EMPTY_PATCH/);
 assert.equal(versionOf('"2"'),2);
 assert.throws(()=>versionOf(undefined),e=>e.status===428);
});
test("idempotency key, pagination and cursor filters are bounded",()=>{
 assert.equal(keyOf({"idempotency-key":"fixture_key_0001"}),"fixture_key_0001");
 assert.throws(()=>keyOf({}),/IDEMPOTENCY_KEY_REQUIRED/);
 assert.throws(()=>listArgs({limit:101}),/INVALID_LIMIT/);
 assert.throws(()=>listArgs({search:"".padEnd(161,"x")}),/INVALID_TEXT/);
 const filters=listArgs({status:"open",limit:2});
 const cursor=makeCursor({id:"fixture123",updatedAt:"2026-10-24T14:00:00Z"},filters);
 assert.equal(readCursor(cursor,filters).id,"fixture123");
 assert.throws(()=>readCursor(cursor,listArgs({status:"new",limit:2})),/INVALID_CURSOR/);
});
test("only explicit support grants allow Member access",()=>{
 assert.equal(supportCapabilities({role:"Admin"}).has("support.note"),true);
 assert.equal(supportCapabilities({role:"Member",permissions:'["jobs","dashboard"]'}).size,0);
 assert.equal(supportCapabilities({role:"Member",permissions:'["support.view"]'}).has("support.note"),false);
 assert.equal(supportCapabilities({role:"Member",permissions:"invalid-json"}).size,0);
});

import {supportSandboxEnabled} from "../server/support/featureFlag.js";
test("Phase 1 mount is fail-closed except explicit local synthetic test stack",()=>{
 const env={NODE_ENV:"test",CI_SUPPORT_SYNTHETIC:"1",
  V79_SUPPORT_DESK_ENABLED:"1",DATABASE_URL:"postgresql://test:test@127.0.0.1:5432/tiquet_support_test"};
 assert.equal(supportSandboxEnabled(env),true);
 assert.equal(supportSandboxEnabled({...env,NODE_ENV:"production"}),false);
 assert.equal(supportSandboxEnabled({...env,CI_SUPPORT_SYNTHETIC:"0"}),false);
 assert.equal(supportSandboxEnabled({...env,V79_SUPPORT_DESK_ENABLED:"0"}),false);
 assert.equal(supportSandboxEnabled({...env,DATABASE_URL:"postgres://db.internal/tiquet_support_test"}),false);
 assert.equal(supportSandboxEnabled({...env,DATABASE_URL:"postgres://127.0.0.1:5432/tiquet"}),false);
 assert.equal(supportSandboxEnabled({...env,DATABASE_URL:undefined}),false);
});
