// Shared secret authentication is still mandatory. This validates the caller's declared
// approved-conversion envelope, not an independent attestation of approval.
export function isApprovedWebsiteConversion(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (body.source !== "website-crm-approved") return false;
  return typeof body.eventId === "string" &&
    /^v79-crm-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.eventId);
}
