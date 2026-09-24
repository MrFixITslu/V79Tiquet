import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLegacyAccount } from '../server/legacyAccountLink.js';

test('linking a known legacy account requires an explicit one-time opt-in', () => {
  const existing={id:'existing-account',hub_organization_id:null};
  assert.throws(() => resolveLegacyAccount([existing],'hub-org',false),/Explicit account-link migration/);
  assert.equal(resolveLegacyAccount([existing],'hub-org',true),existing);
  assert.equal(resolveLegacyAccount([],'hub-org',false),null);
});

test('ambiguous or already owned legacy accounts cannot be claimed', () => {
  const first={id:'one',hub_organization_id:null}, second={id:'two',hub_organization_id:null};
  assert.throws(() => resolveLegacyAccount([first,second],'hub-org',true),/Multiple legacy/);
  assert.throws(() => resolveLegacyAccount([{...first,hub_organization_id:'other-org'}],'hub-org',true),/another Hub organisation/);
});
