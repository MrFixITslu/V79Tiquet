import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import platformRouter from "../server/platform.js";

function signature(secret, method, pathname, timestamp, body) {
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  return crypto.createHmac("sha256", secret)
    .update([method, pathname, timestamp, hash].join("\n")).digest("hex");
}

test("Tiquet Stage 4 router enforces HMAC, timestamp, service identity and default-off mode", async () => {
  const original = {
    shared: process.env.V79_PLATFORM_SHARED_SECRET,
    enabled: process.env.V79_AGENT_SUPERVISED_DRAFTS_ENABLED,
  };
  const secret = "synthetic-stage4-test-key-not-production-12345678";
  process.env.V79_PLATFORM_SHARED_SECRET = secret;
  delete process.env.V79_AGENT_SUPERVISED_DRAFTS_ENABLED;

  const app = express();
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); },
  }));
  app.use("/api/platform", platformRouter);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    for (const pathname of [
      "/api/platform/agent-draft-tickets",
      "/api/platform/agent-reply-drafts",
    ]) {
      const body = pathname.endsWith("tickets")
        ? JSON.stringify({ organizationId: "synthetic-org-a", actorHubUserId: "synthetic-owner-a" })
        : JSON.stringify({ organizationId: "synthetic-org-a", actorHubUserId: "synthetic-owner-a",
            proposalId: "12345678-1234-4123-8123-123456789abc", jobId: "job-a",
            content: "Internal-only synthetic review notes; do not send." });
      const at = String(Date.now());
      const good = signature(secret, "POST", pathname, at, body);
      const send = (overrides = {}, payload = body) => fetch(origin + pathname, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-v79-service-id": "v79-hub",
          "x-v79-timestamp": at,
          "x-v79-signature": good,
          ...overrides,
        },
        body: payload,
      });
      assert.equal((await fetch(origin + pathname, {
        method: "POST", headers: { "content-type": "application/json" }, body,
      })).status, 401, "unsigned request denied");
      assert.equal((await send({ "x-v79-service-id": "third-party" })).status, 401);
      assert.equal((await send({ "x-v79-signature": "00".repeat(32) })).status, 401);
      assert.equal((await send({ "x-v79-timestamp": String(Date.now() - 600000) })).status, 401);
      assert.equal((await send({}, body + " ")).status, 401, "body tampering denied");
      assert.equal((await send()).status, 503, "validly signed request still disabled by default");
    }
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    if (original.shared === undefined) delete process.env.V79_PLATFORM_SHARED_SECRET;
    else process.env.V79_PLATFORM_SHARED_SECRET = original.shared;
    if (original.enabled === undefined) delete process.env.V79_AGENT_SUPERVISED_DRAFTS_ENABLED;
    else process.env.V79_AGENT_SUPERVISED_DRAFTS_ENABLED = original.enabled;
  }
});
