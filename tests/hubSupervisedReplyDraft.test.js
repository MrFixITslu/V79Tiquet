import test from "node:test";
import assert from "node:assert/strict";
import { createHubTicketReplyDraft, validateHubTicketDraftRequest } from "../server/hubSupervisedReplyDraft.js";

const request = {
  organizationId: "synthetic-org-a",
  actorHubUserId: "synthetic-owner-a",
  proposalId: "12345678-1234-4123-8123-123456789abc",
  jobId: "job-a",
  content: "Internal reply draft\nHuman owner must review before sending anything.",
};

function dbFixture() {
  const rows = [];
  const calls = [];
  const db = {
    calls, rows,
    prepare(sql) {
      calls.push(sql);
      return {
        async get(...args) {
          if (sql.includes("FROM accounts")) return args[0] === "synthetic-org-a" ? { id: "acct-a" } : undefined;
          if (sql.includes("FROM users")) return args[0] === "acct-a" && args[1] === "synthetic-owner-a"
            ? { id: "owner-a" } : undefined;
          if (sql.includes("FROM jobs")) return args[0] === "job-a" && args[1] === "acct-a"
            ? { id: "job-a" } : undefined;
          if (sql.includes("COUNT(*)")) return { n: rows.length };
          if (sql.includes("FROM agent_reply_drafts")) return rows.find(r =>
            r.account_id === args[0] && r.idempotency_key === args[1]);
          throw Error("Unexpected query in fake DB");
        },
        async run(id, accountId, jobId, createdBy, key, content, timestamp) {
          assert.ok(sql.startsWith("INSERT INTO agent_reply_drafts"));
          if (rows.some(r => r.account_id === accountId && r.idempotency_key === key)) return { changes: 0 };
          rows.push({ id, account_id: accountId, job_id: jobId, created_by: createdBy,
            idempotency_key: key, content, created_at: timestamp });
          return { changes: 1 };
        },
      };
    },
  };
  return db;
}

test("only bounded internal draft fields accepted", () => {
  assert.deepEqual(validateHubTicketDraftRequest(request), request);
  for (const extra of [
    { accountId: "acct-b" }, { recipient: "customer@example.invalid" },
    { send: true }, { status: "SENT" }, { notify: true },
    { publish: true }, { idempotencyKey: "manual-override" },
  ]) assert.equal(validateHubTicketDraftRequest({ ...request, ...extra }), null);
  assert.equal(validateHubTicketDraftRequest({ ...request, jobId: "../other" }), null);
  assert.equal(validateHubTicketDraftRequest({ ...request, content: "too short" }), null);
  assert.equal(validateHubTicketDraftRequest({ ...request, content: request.content + "\r" }), null);
});

test("signed-owner-scoped request creates exactly one draft without messaging", async () => {
  const db = dbFixture();
  const created = await createHubTicketReplyDraft(db, request);
  assert.equal(created.kind, "created");
  assert.equal(created.draft.accountId, "acct-a");
  assert.equal(created.draft.jobId, "job-a");
  assert.equal(created.draft.createdBy, "owner-a");
  assert.equal(created.draft.status, "DRAFT");
  assert.equal((await createHubTicketReplyDraft(db, request)).kind, "duplicate");
  assert.equal((await createHubTicketReplyDraft(db, {
    ...request, content: request.content + "\nChanged",
  })).kind, "conflict");
  assert.equal(db.rows.length, 1);
  assert.ok(db.calls.every(sql => !/job_messages|notifications|deliveries|send|publish/i.test(sql)));
});

test("cross-organisation owner, unmatched ticket and unlinked staff fail", async () => {
  const db = dbFixture();
  assert.equal((await createHubTicketReplyDraft(db, {
    ...request, organizationId: "synthetic-org-b",
  })).kind, "not_found");
  assert.equal((await createHubTicketReplyDraft(db, {
    ...request, actorHubUserId: "synthetic-staff-a",
  })).kind, "not_found");
  assert.equal((await createHubTicketReplyDraft(db, {
    ...request, jobId: "job-b",
  })).kind, "not_found");
  assert.equal(db.rows.length, 0);
});
