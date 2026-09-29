export function resolveLegacyAccount(candidates, hubOrgId) {
  if (candidates.length > 1) {
    throw new Error('Multiple legacy Tiquet accounts match this email. Resolve the account mapping before linking.');
  }
  const account = candidates[0] || null;
  if (account?.hub_organization_id && account.hub_organization_id !== hubOrgId) {
    throw new Error('This Tiquet account is already linked to another Hub organisation.');
  }
  return account;
}

export function assertHubUserAccount(user, accountId, hubUserId) {
  if (!user) return;
  if (user.account_id !== accountId || (user.hub_user_id && user.hub_user_id !== hubUserId)) {
    throw new Error('This Tiquet identity belongs to another account or Hub user.');
  }
}
