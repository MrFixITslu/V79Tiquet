// The signed session must not select another organization's Hub entitlement.
export function hubManagedMapping({ accountOrganizationId, linkedUserId, tokenOrganizationId, tokenHubManaged }) {
  const org = String(accountOrganizationId || "").trim();
  const user = String(linkedUserId || "").trim();
  const jwtOrg = String(tokenOrganizationId || "").trim();
  const managed = Boolean(org || user || jwtOrg || tokenHubManaged);
  return {
    managed,
    valid: Boolean(org && user && (!jwtOrg || jwtOrg === org)),
  };
}
