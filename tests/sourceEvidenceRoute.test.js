import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync, verify as verifyEd25519 } from "node:crypto";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createTiquetSignedEvidenceHandler } from "../server/sourceEvidenceRoute.js";
import { canonicalTiquetSourceMetrics } from "../server/sourceEvidenceSigner.js";

const orgId = "ci-tenant-alpha-123";
const requestId = "01234567-89ab-4cde-8000-0123456789ab";
const instant = new Date("2026-10-09T12:00:00.000Z");
const input = JSON.stringify({ organizationId: orgId, requestId });

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "tiquet-source-evidence-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const keys = generateKeyPairSync("ed25519");
  const keyFile = join(dir, "source-private.pem");
  await writeFile(keyFile, keys.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  await chmod(keyFile, 0o600);

  let enabled = false;
  let selectedKey = keyFile;
  let suspended = false;
  let absent = false;
  let calls = [];
  const fakeDb = {
    prepare(sql) {
      assert.match(sql, /^SELECT\b/i, "signed evidence must never perform an SQL write");
      assert.doesNotMatch(sql, /\b(UPDATE|DELETE|INSERT|DROP|ALTER)\b/i);
      return {
        async get(accountId) {
          calls.push({ sql, accountId });
          if (/FROM accounts\b/i.test(sql)) {
            assert.equal(accountId, orgId);
            if (absent) return null;
            return { id: "synthetic-tiquet-account", status: suspended ? "suspended" : "active",
              hub_organization_id: orgId };
          }
          assert.equal(accountId, "synthetic-tiquet-account", "every aggregate is tenant-scoped");
          if (/FROM clients\b/i.test(sql)) return { count: 2 };
          if (/FROM jobs\b/i.test(sql) && /SUM\(/i.test(sql)) return { total: 135.5 };
          if (/FROM jobs\b/i.test(sql)) return { count: 4 };
          if (/FROM users\b/i.test(sql)) return { count: 1 };
          if (/FROM notifications\b/i.test(sql)) return { count: 3 };
          throw Error("Unrecognised SQL query");
        },
      };
    },
  };

  const app = express();
  app.use(express.json({ limit: "4kb" }));
  app.post("/evidence/signed", createTiquetSignedEvidenceHandler({
    db: fakeDb, enabled: () => enabled, signingKeyFile: () => selectedKey,
    now: () => instant,
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function post(body=input) {
    const response = await fetch(base + "/evidence/signed", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    return { status: response.status, cache: response.headers.get("cache-control"),
      body: await response.json() };
  }
  return { post, keys, keyFile, dir, calls: () => calls, enable: () => enabled = true,
    suspend: () => suspended = true, absent: () => absent = true, keyPath: value => selectedKey = value };
}

test("source evidence is disabled without touching the tenant database", async t => {
  const h = await setup(t);
  const value = await h.post();
  assert.equal(value.status, 404);
  assert.equal(value.cache, "no-store");
  assert.equal(h.calls().length, 0);
});

test("read-only source envelope signs synthetic account counts and no customer fields", async t => {
  const h = await setup(t);
  h.enable();
  const value = await h.post();
  assert.equal(value.status, 200, JSON.stringify(value.body));
  assert.equal(value.body.executionEnabled, false);
  assert.equal(value.body.algorithm, "ed25519");
  assert.equal(value.body.payload.organizationId, orgId);
  assert.equal(value.body.payload.requestId, requestId);
  assert.equal(value.body.payload.metrics.length, 5);
  assert.equal("clientEmail" in value.body.payload, false);
  assert.equal("ticketBody" in value.body.payload, false);
  const canonical = canonicalTiquetSourceMetrics(value.body.payload);
  assert.ok(canonical);
  assert.equal(verifyEd25519(null, Buffer.from(canonical, "utf8"), h.keys.publicKey,
    Buffer.from(value.body.signature, "base64url")), true);
  assert.equal(h.calls().length, 6, "one account lookup and five aggregate reads");
  assert.equal(h.calls().slice(1).every(entry => entry.accountId === "synthetic-tiquet-account"), true);
});

test("wrong tenants, suspended workspace and malformed requests are refused without signing", async t => {
  const h = await setup(t);
  h.enable();
  assert.equal((await h.post(JSON.stringify({ organizationId: "wrong-tenant-org", requestId }))).status, 503,
    "this synthetic DB rejects even attempted cross-tenant access");
  assert.equal((await h.post("{}")).status, 400);
  assert.equal((await h.post(JSON.stringify({ organizationId: orgId, requestId, execute: true }))).status, 400);
  h.absent();
  assert.equal((await h.post()).status, 404);
  const g = await setup(t);
  g.enable();g.suspend();
  assert.equal((await g.post()).status, 403);
});

test("source signing fails closed without an owner-only regular private key", async t => {
  const h = await setup(t);
  h.enable();
  h.keyPath("");
  assert.equal((await h.post()).status, 503);
  h.keyPath(join(h.dir, "does-not-exist.pem"));
  assert.equal((await h.post()).status, 503);
  const exposed = join(h.dir, "group-readable.pem");
  await writeFile(exposed, h.keys.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o640 });
  await chmod(exposed, 0o640);
  h.keyPath(exposed);
  assert.equal((await h.post()).status, 503);
  const link = join(h.dir, "private-symlink.pem");
  await symlink(h.keyFile, link);
  h.keyPath(link);
  assert.equal((await h.post()).status, 503);
  assert.equal(h.calls().length, 0, "unauthorized key paths must not read the database");
});
