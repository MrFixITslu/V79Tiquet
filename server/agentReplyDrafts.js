import crypto from "node:crypto";

// Isolated, internal-only ticket reply drafts. Never accesses job_messages,
// email, websocket broadcasts, notifications or any customer-visible endpoint.
export function validateAgentReplyDraft(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !keys.every(key => ["content", "idempotencyKey"].includes(key))) return null;
  const { content, idempotencyKey } = raw;
  if (typeof content !== "string" || content !== content.trim() ||
      content.length < 12 || content.length > 2000 ||
      /[\u0000-\u001f\u007f]/.test(content) ||
      typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,96}$/.test(idempotencyKey)) return null;
  return { content, idempotencyKey };
}

function mapDraft(row) {
  return { id: row.id, jobId: row.job_id, accountId: row.account_id,
    createdBy: row.created_by, content: row.content, status: "DRAFT",
    createdAt: row.created_at };
}

export async function createAgentReplyDraft(db, actor, jobId, raw, {
  uuid = crypto.randomUUID, now = () => new Date().toISOString(),
} = {}) {
  if (!actor?.userId || !actor?.accountId || typeof jobId !== "string" ||
      jobId.length < 1 || jobId.length > 180) return { kind: "invalid" };
  const input = validateAgentReplyDraft(raw);
  if (!input) return { kind: "invalid" };
  const job = await db.prepare(
    "SELECT id FROM jobs WHERE id = ? AND account_id = ?",
  ).get(jobId, actor.accountId);
  if (!job) return { kind: "not_found" };

  const existingQuery = "SELECT * FROM agent_reply_drafts WHERE account_id = ? AND idempotency_key = ?";
  const old = await db.prepare(existingQuery).get(actor.accountId, input.idempotencyKey);
  if (old) return old.job_id === jobId && old.content === input.content && old.created_by === actor.userId
    ? { kind: "duplicate", draft: mapDraft(old) } : { kind: "conflict" };

  const count = await db.prepare(
    "SELECT COUNT(*) AS n FROM agent_reply_drafts WHERE account_id = ?",
  ).get(actor.accountId);
  if (Number(count?.n ?? 0) >= 250) return { kind: "limit" };

  const id = uuid();
  const timestamp = now();
  const write = await db.prepare(
    `INSERT INTO agent_reply_drafts
      (id,account_id,job_id,created_by,idempotency_key,content,status,created_at)
      VALUES (?,?,?,?,?,?,'DRAFT',?)
      ON CONFLICT (account_id,idempotency_key) DO NOTHING`,
  ).run(id, actor.accountId, jobId, actor.userId, input.idempotencyKey, input.content, timestamp);
  if (write.changes === 0) {
    const raced = await db.prepare(existingQuery).get(actor.accountId, input.idempotencyKey);
    return raced?.job_id === jobId && raced.content === input.content && raced.created_by === actor.userId
      ? { kind: "duplicate", draft: mapDraft(raced) } : { kind: "conflict" };
  }
  return { kind: "created",
    draft: { id, jobId, accountId: actor.accountId, createdBy: actor.userId,
      content: input.content, status: "DRAFT", createdAt: timestamp } };
}

export async function listAgentReplyDrafts(db, actor, jobId) {
  if (!actor?.userId || !actor?.accountId || typeof jobId !== "string" || jobId.length > 180) return null;
  const job = await db.prepare("SELECT id FROM jobs WHERE id = ? AND account_id = ?").get(jobId, actor.accountId);
  if (!job) return null;
  const rows = await db.prepare(
    "SELECT * FROM agent_reply_drafts WHERE account_id = ? AND job_id = ? ORDER BY created_at DESC, id DESC LIMIT 100",
  ).all(actor.accountId, jobId);
  return rows.map(mapDraft);
}
