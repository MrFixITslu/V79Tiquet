/**
 * Allowlisted, PII-minimised outbound events for V79 Hub.
 * This is not payment reconciliation and MUST NOT alter Hub accounting data.
 */
const TYPE_FIELDS = Object.freeze({
  "job.created": ["status", "priority", "origin"],
  "job.status_changed": ["status", "previousStatus"],
  "job.paid": [],
  "customer.created": ["origin"],
  "payment.recorded": ["currency", "method", "provider"],
  "customer.feedback_submitted": ["rating", "contactAllowed"],
  "job.scope_acknowledged": ["version"],
});
const SAFE = /^[A-Za-z0-9_ .:-]{1,64}$/;
const ID = /^[A-Za-z0-9._:@-]{4,180}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function makeHubEventProjection(row, raw) {
  if (!row || !ID.test(String(row.hub_organization_id || "")) ||
      !ID.test(String(row.account_id || "")))
    return { ok:false, reason:"missing_verified_hub_mapping" };
  if (!UUID.test(String(row.id || "")) || !Object.hasOwn(TYPE_FIELDS, row.event_type) ||
      !ID.test(String(row.subject_id || "")) ||
      !Number.isFinite(Date.parse(row.occurred_at)))
    return { ok:false, reason:"invalid_event_metadata" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok:false, reason:"invalid_event_payload" };
  const payload = {};
  for (const k of TYPE_FIELDS[row.event_type]) {
    if (!Object.hasOwn(raw,k)) continue;
    const value=raw[k];
    if (typeof value !== "string" || !SAFE.test(value) ||
        /@|https?:|bearer|token|secret/i.test(value))
      return {ok:false,reason:"disallowed_payload_value"};
    payload[k]=value;
  }
  if (row.event_type === "customer.feedback_submitted" &&
      (!/^[1-5]$/.test(payload.rating || "") ||
       !["yes","no"].includes(payload.contactAllowed))) 
    return {ok:false,reason:"invalid_feedback_category"};
  if (row.event_type === "job.scope_acknowledged" &&
      !/^[1-9][0-9]{0,6}$/.test(payload.version || ""))
    return {ok:false,reason:"invalid_scope_version"};
  if (payload.currency && !/^[A-Z]{3}$/.test(payload.currency))
    return {ok:false,reason:"invalid_currency"};
  return {
    ok:true,
    event:{
      id:row.id,
      type:row.event_type,
      version:1,
      occurredAt:new Date(row.occurred_at).toISOString(),
      organizationRef:row.hub_organization_id,
      accountRef:row.account_id,
      subjectId:row.subject_id,
      // Website event UUID connects the lead to its Tiquet request without
      // copying the customer's name, email or free-text enquiry into Hub.
      ...(UUID.test(String(row.correlation_id || "")) ?
        { correlationId:row.correlation_id } : {}),
      payload,
    },
  };
}
