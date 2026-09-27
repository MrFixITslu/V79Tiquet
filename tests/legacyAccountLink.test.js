import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLegacyAccount } from '../server/legacyAccountLink.js';

test('a single unlinked legacy account may be migrated by a signed Hub owner launch', () => {
  const existing={id:'existing-account',hub_organization_id:null};
  assert.equal(resolveLegacyAccount([existing],'hub-org'),existing);
  assert.equal(resolveLegacyAccount([],'hub-org'),null);
});

test('ambiguous or already owned legacy accounts cannot be claimed', () => {
  const first={id:'one',hub_organization_id:null}, second={id:'two',hub_organization_id:null};
  assert.throws(() => resolveLegacyAccount([first,second],'hub-org'),/Multiple legacy/);
  assert.throws(() => resolveLegacyAccount([{...first,hub_organization_id:'other-org'}],'hub-org'),/another Hub organisation/);
});
