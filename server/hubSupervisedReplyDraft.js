import { createAgentReplyDraft } from "./agentReplyDrafts.js";

const HUB_ID_RE = /^[A-Za-z0-9._:@-]{8,180}$/;
const JOB_ID_RE = /^[A-Za-z0-9._:@-]{1,180}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Pure input validation. The signed /api/platform middleware authenticates
// the calling Hub service before this function is invoked.
export function validateHubTicketDraftRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 5 || !keys.every(k =>
      ["organizationId", "actorHubUserId", "proposalId", "jobId", "content"].includes(k))) return null;
  const { organizationId, actorHubUserId, proposalId, jobId, content } = body;
  if (typeof organizationId !== "string" || !HUB_ID_RE.test(organizationId) ||
      typeof actorHubUserId !== "string" || !HUB_ID_RE.test(actorHubUserId) ||
      typeof proposalId !== "string" || !UUID_RE.test(proposalId) ||
      typeof jobId !== "string" || !JOB_ID_RE.test(jobId) ||
      typeof content !== "string" || content.trim() !== content ||
      content.length < 12 || content.length > 2000 ||
      /[\u0000-\u0009\u000b-\u001f\u007f]/.test(content)) return null;
  return { organizationId, actorHubUserId, proposalId, jobId, content };
}

// Never auto-create a ticket or account. A Hub owner must select an existing
// ticket, with a separate Hub confirmation, before this endpoint can be used.
export async function createHubTicketReplyDraft(db, raw) {
  const input = validateHubTicketDraftRequest(raw);
  if (!input) return { kind: "invalid" };
  const account = await db.prepare(
    "SELECT id FROM accounts WHERE hub_organization_id = ? AND status = 'active'"
  ).get(input.organizationId);
  if (!account) return { kind: "not_found" };
  const owner = await db.prepare(
    "SELECT id FROM users WHERE account_id = ? AND hub_user_id = ? AND role = 'Admin'"
  ).get(account.id, input.actorHubUserId);
  if (!owner) return { kind: "not_found" };
  return createAgentReplyDraft(db, {
    accountId: account.id, userId: owner.id,
  }, input.jobId, {
    content: input.content,
    idempotencyKey: "hubproposal_" + input.proposalId.replaceAll("-", "").toLowerCase(),
  });
}
