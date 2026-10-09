import test from "node:test";
import assert from "node:assert/strict";
import { createAgentReplyDraft, listAgentReplyDrafts, validateAgentReplyDraft } from "../server/agentReplyDrafts.js";

const body = { content: "This is an internal reply draft for a staff member to review before sending.", idempotencyKey: "internal-ticket-draft-0001" };
const actor = { userId: "staff-1", accountId: "tenant-A" };

function fakeDatabase() {
  const tickets = new Map([["ticket-A", "tenant-A"], ["ticket-B", "tenant-B"]]);
  const draftRows = [];
  const queries = [];
  return { queries, draftRows,
    prepare(sql) {
      queries.push(sql);
      return {
        async get(...args) {
          if (sql.includes("FROM jobs")) return tickets.get(args[0]) === args[1] ? { id: args[0] } : undefined;
          if (sql.includes("COUNT(*)")) return { n: draftRows.filter(p => p.account_id === args[0]).length };
          if (sql.includes("FROM agent_reply_drafts")) return draftRows.find(p => p.account_id === args[0] && p.idempotency_key === args[1]);
          throw Error("Unexpected test query");
        },
        async all(accountId, jobId) {
          if (!sql.includes("FROM agent_reply_drafts")) throw Error("Unexpected test query");
          return draftRows.filter(p => p.account_id === accountId && p.job_id === jobId);
        },
        async run(id, accountId, jobId, createdBy, idempotencyKey, content, createdAt) {
          if (!sql.startsWith("INSERT INTO agent_reply_drafts")) throw Error("Unsafe SQL target");
          if (draftRows.some(row => row.account_id === accountId && row.idempotency_key === idempotencyKey)) return { changes: 0 };
          draftRows.push({ id, account_id:accountId, job_id:jobId, created_by:createdBy,
            idempotency_key:idempotencyKey, content, created_at:createdAt });
          return { changes: 1 };
        },
      };
    },
  };
}

test("rejects external dispatch fields, oversized content and arbitrary identifiers", () => {
  assert.deepEqual(validateAgentReplyDraft(body), body);
  for (const additional of [{ send:true }, { publish:true }, { accountId:"tenant-B" },
    { status:"SENT" }, { recipient:"customer@example.invalid" }]) {
    assert.equal(validateAgentReplyDraft({ ...body, ...additional }), null);
  }
  assert.equal(validateAgentReplyDraft({ ...body, content:"short" }), null);
  assert.equal(validateAgentReplyDraft({ ...body, idempotencyKey:"short" }), null);
  assert.equal(validateAgentReplyDraft({ ...body, content:"x".repeat(2001) }), null);
});

test("writes only a DRAFT scoped to the ticket's owning account", async () => {
  const db = fakeDatabase();
  const result = await createAgentReplyDraft(db, actor, "ticket-A", body);
  assert.equal(result.kind, "created");
  assert.equal(result.draft.status, "DRAFT");
  assert.equal((await listAgentReplyDrafts(db, actor, "ticket-A")).length, 1);
  assert.equal(await listAgentReplyDrafts(db, actor, "ticket-B"), null);
  assert.equal((await createAgentReplyDraft(db, actor, "ticket-B", body)).kind, "not_found");
  assert.ok(db.queries.every(sql => !/job_messages|send|publish|notifications|deliveries/i.test(sql)));
});

test("retry is idempotent, conflicts fail and tenants are independent", async () => {
  const db = fakeDatabase();
  assert.equal((await createAgentReplyDraft(db, actor, "ticket-A", body)).kind, "created");
  assert.equal((await createAgentReplyDraft(db, actor, "ticket-A", body)).kind, "duplicate");
  assert.equal((await createAgentReplyDraft(db, actor, "ticket-A", {
    ...body, content: "Updated staff draft must use a different idempotency key.",
  })).kind, "conflict");
  assert.equal((await createAgentReplyDraft(db, { userId:"staff-2",accountId:"tenant-B" }, "ticket-B", body)).kind, "created");
  assert.equal(db.draftRows.length, 2);
});

test("accepts multiline reviewed briefs, but blocks other ASCII controls", () => {
  const content = "V79 reviewed brief\nDestination: Tiquet\nDraft only — no customer send.";
  assert.equal(validateAgentReplyDraft({ ...body, content })?.content, content);
  assert.equal(validateAgentReplyDraft({ ...body, content: content.replaceAll("\\n", "\\r\\n") }), null);
  for (const control of ["\\u0000","\\u0001","\\t","\\u001b","\\u007f"]) {
    assert.equal(validateAgentReplyDraft({ ...body, content: content + control }), null);
  }
});
