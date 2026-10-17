import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_SOCKET_REVALIDATION_MS, isStalledSocketRevalidation
} from '../server/tiquetSocketHeartbeatGuard.js';

test('slow but within time-box staff/portal checks keep their current bounded room membership',()=>{
  const now=1_000_000;
  assert.equal(MAX_SOCKET_REVALIDATION_MS,30_000);
  assert.equal(isStalledSocketRevalidation({entitlementCheckInFlight:true,
    entitlementCheckStartedAt:now-14999},now),false);
  assert.equal(isStalledSocketRevalidation({entitlementCheckInFlight:true,
    entitlementCheckStartedAt:now-29999},now),false);
});
test('hung checks, missing source timestamp, and clock uncertainty fail closed',()=>{
  const now=1_000_000;
  for(const started of [now-30000,now-30001,undefined,null,NaN,Infinity,now+1001]){
    assert.equal(isStalledSocketRevalidation({entitlementCheckInFlight:true,
      entitlementCheckStartedAt:started},now),true,String(started));
  }
  assert.equal(isStalledSocketRevalidation({
    entitlementCheckInFlight:true,entitlementCheckStartedAt:now-1},NaN),true);
});
test('idle sockets do not become unauthorized merely because an old clock field remains',()=>{
  const now=1_000_000;
  assert.equal(isStalledSocketRevalidation({
    entitlementCheckInFlight:false,entitlementCheckStartedAt:now-60000},now),false);
  assert.equal(isStalledSocketRevalidation({},now),false);
  assert.equal(isStalledSocketRevalidation(null,now),false);
});
test('production heartbeat binds fail-closed guard to unsubscribe and socket termination',()=>{
  const source=fs.readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
  assert.match(source,/if \(ws\.entitlementCheckInFlight\) \{\s*\/\/[\s\S]*?if \(isStalledSocketRevalidation\(ws\)\) \{\s*unsubscribeFromJob\(ws\.jobId, ws\);\s*ws\.terminate\(\);/);
  assert.match(source,/ws\.entitlementCheckStartedAt = Date\.now\(\);/);
  assert.match(source,/ws\.entitlementCheckStartedAt = null;/);
  assert.match(source,/}, 15000\);/,'Existing 15-second heartbeat retained');
});
