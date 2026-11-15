// Website enquiry reference and staff-approved CRM conversion contract.
// No customer is created or converted during anonymous intake.
const WEBSITE_EVENT = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function websiteTicketReference(jobId) {
  if (!WEBSITE_EVENT.test(String(jobId || ""))) throw new Error("Invalid ticket identifier");
  return "TQ-" + String(jobId).replaceAll("-", "").slice(0, 12).toUpperCase();
}

export function isWebsiteEvent(value) {
  return WEBSITE_EVENT.test(String(value || ""));
}

export function validateContactOutcome(outcome, notes) {
  if (!["confirmed", "callback", "declined"].includes(outcome))
    throw new Error("Select Confirmed, Call Back or Declined.");
  if (typeof notes !== "string" || notes.trim().length < 10 || notes.length > 1500)
    throw new Error("Record 10–1,500 characters describing the customer call.");
  return { outcome, notes: notes.trim() };
}

export function crmConversionConfigured(env = process.env) {
  return !!(env.TIQUET_WEBSITE_CRM_CONVERT_URL &&
    env.TIQUET_WEBSITE_CRM_SECRET?.length >= 32 &&
    env.INTAKE_ACCOUNT_ID);
}

export async function submitConfirmedCustomerToWebsite({
  jobId, intakeEventId, accountId, confirmationNotes, confirmedBy,
  env = process.env, transport = fetch,
}) {
  if (!crmConversionConfigured(env)) {
    const error = new Error("Website CRM integration is not configured.");
    error.status = 503; throw error;
  }
  if (!isWebsiteEvent(jobId) || !isWebsiteEvent(intakeEventId) || accountId !== env.INTAKE_ACCOUNT_ID) {
    const error = new Error("This ticket is not an authorised website enquiry.");
    error.status = 403; throw error;
  }
  const url = new URL(env.TIQUET_WEBSITE_CRM_CONVERT_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.pathname.endsWith("/api/integrations/tiquet/customer-convert")) {
    const error = new Error("Invalid website CRM service URL.");
    error.status = 503; throw error;
  }
  const response = await transport(url.href, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-V79-Tiquet-CRM-Secret": env.TIQUET_WEBSITE_CRM_SECRET,
    },
    body: JSON.stringify({ jobId, intakeEventId, sourceAccountId: accountId, confirmationNotes, confirmedBy }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true ||
      !Number.isSafeInteger(result.crmLeadId) || result.crmLeadId < 1 ||
      typeof result.customerId !== "string" || !/^V79-CLI-[a-f0-9]{6,20}$/i.test(result.customerId)) {
    const error = new Error(
      response.status === 404 || response.status === 409
        ? (result.error || "Website CRM record needs manual review.")
        : "Website CRM did not confirm conversion. You can safely retry."
    );
    error.status = response.status === 404 || response.status === 409 ? 409 : 503;
    throw error;
  }
  return { crmLeadId: result.crmLeadId, crmCustomerId: result.customerId, alreadyConverted: !!result.alreadyConverted };
}
