export function resolveLegacyAccount(candidates, hubOrgId, enabled) {
  if (candidates.length > 1) {
    throw new Error('Multiple legacy Tiquet accounts match this email. Resolve the account mapping before linking.');
  }
  const account = candidates[0] || null;
  if (account?.hub_organization_id && account.hub_organization_id !== hubOrgId) {
    throw new Error('This Tiquet account is already linked to another Hub organisation.');
  }
  if (account && !enabled) {
    throw new Error('Existing Tiquet account found. Explicit account-link migration is required before Hub access.');
  }
  return account;
}
