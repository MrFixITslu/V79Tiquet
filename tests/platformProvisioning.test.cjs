const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const secret = process.env.V79_PLATFORM_SHARED_SECRET || "";
const jwtSecret = process.env.JWT_SECRET || "";

function signature(method, pathname, timestamp, body = "") {
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = [method.toUpperCase(), pathname, String(timestamp), hash].join("\n");
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

async function platformRequest(pathname, { method = "GET", body = "" } = {}) {
  const timestamp = String(Date.now());
  const response = await fetch(base + pathname, {
    method,
    headers: {
      "content-type": "application/json",
      "x-v79-service-id": "v79-hub",
      "x-v79-timestamp": timestamp,
      "x-v79-signature": signature(method, pathname, timestamp, body),
    },
    body: body || undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function provision(organizationId, name, hubUserId, email) {
  const body = JSON.stringify({
    organization: { id: organizationId, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") },
    user: { id: hubUserId, email, name: "Shared Owner" },
    role: "owner",
    plan: "hub",
  });
  const result = await platformRequest("/api/platform/provision", { method: "POST", body });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.provisioned, true);
  assert.equal(result.payload.organizationId, organizationId);
  assert.equal(result.payload.ownerHubUserId, hubUserId);
  assert.ok(result.payload.accountId);
  assert.ok(result.payload.userId);
  return result.payload;
}

async function deprovisionMember(organizationId, hubUserId) {
  const body = JSON.stringify({ organizationId, user: { id: hubUserId } });
  return platformRequest("/api/platform/members/deprovision", { method: "POST", body });
}

async function provisionMember(organizationId, name, hubUserId, email, role) {
  const body = JSON.stringify({
    organization: { id: organizationId, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") },
    user: { id: hubUserId, email, name: `${role} Member` },
    role,
    plan: "hub",
  });
  const result = await platformRequest("/api/platform/members/provision", { method: "POST", body });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.provisioned, true);
  assert.equal(result.payload.organizationId, organizationId);
  assert.equal(result.payload.hubUserId, hubUserId);
  assert.equal(result.payload.localRole, "Member");
  assert.ok(Array.isArray(result.payload.permissions));
  assert.ok(result.payload.accountId);
  assert.ok(result.payload.userId);
  return result.payload;
}

function memberToken(member, email) {
  return jwt.sign(
    { id: member.userId, email, account_id: member.accountId },
    jwtSecret,
    { expiresIn: "10m" }
  );
}

async function memberRequest(pathname, token, { method = "GET", body } = {}) {
  return fetch(base + pathname, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

(async () => {
  assert.ok(secret.length >= 32, "V79_PLATFORM_SHARED_SECRET must be configured for platform tests");

  const email = "shared-owner@example.test";
  const a = await provision("hub-org-a-1234", "Tiquet Business A", "hub-user-a-1234", email);
  const b = await provision("hub-org-b-1234", "Tiquet Business B", "hub-user-b-1234", email);

  assert.notEqual(a.accountId, b.accountId, "separate Hub workspaces must get separate Tiquet accounts");
  assert.notEqual(a.userId, b.userId, "separate Hub workspaces must get separate Tiquet users");
  assert.ok(jwtSecret.length >= 32, "JWT_SECRET must be configured for platform permission tests");

  const managerEmail = "manager-a@example.test";
  const manager = await provisionMember(
    "hub-org-a-1234",
    "Tiquet Business A",
    "hub-manager-a-1234",
    managerEmail,
    "manager"
  );
  assert.deepEqual(
    new Set(manager.permissions),
    new Set(["dashboard", "jobs", "clients", "invoices", "files", "new-request"])
  );
  const managerJwt = memberToken(manager, managerEmail);
  assert.equal((await memberRequest("/api/jobs", managerJwt)).status, 200);
  assert.equal((await memberRequest("/api/clients", managerJwt)).status, 200);
  assert.equal((await memberRequest("/api/files", managerJwt)).status, 200);
  assert.equal((await memberRequest("/api/users", managerJwt)).status, 403);
  assert.equal((await memberRequest("/api/settings", managerJwt, { method: "PUT", body: { name: "Nope" } })).status, 403);

  const viewerEmail = "viewer-a@example.test";
  const viewer = await provisionMember(
    "hub-org-a-1234",
    "Tiquet Business A",
    "hub-viewer-a-1234",
    viewerEmail,
    "viewer"
  );
  assert.deepEqual(viewer.permissions, ["dashboard"]);
  const viewerJwt = memberToken(viewer, viewerEmail);
  const viewerMe = await memberRequest("/api/auth/me", viewerJwt);
  assert.equal(viewerMe.status, 200);
  const viewerMeBody = await viewerMe.json();
  assert.equal(viewerMeBody.role, "Member");
  assert.deepEqual(viewerMeBody.permissions, ["dashboard"]);
  assert.equal((await memberRequest("/api/jobs", viewerJwt)).status, 200, "viewer may read dashboard job feed");
  assert.equal((await memberRequest("/api/jobs", viewerJwt, {
    method: "POST",
    body: { title: "Should fail", client: "No access" },
  })).status, 403);
  assert.equal((await memberRequest("/api/clients", viewerJwt)).status, 403);
  assert.equal((await memberRequest("/api/files", viewerJwt)).status, 403);
  assert.equal((await memberRequest("/api/payroll", viewerJwt)).status, 403);
  assert.equal((await memberRequest("/api/users", viewerJwt)).status, 403);
  assert.equal((await memberRequest("/api/settings", viewerJwt, { method: "PUT", body: { name: "Nope" } })).status, 403);

  const wrongAccountJwt = jwt.sign(
    { id: viewer.userId, email: viewerEmail, account_id: b.accountId },
    jwtSecret,
    { expiresIn: "10m" }
  );
  assert.equal((await memberRequest("/api/jobs", wrongAccountJwt)).status, 401);

  const wrongWorkspaceRemoval = await deprovisionMember("hub-org-b-1234", "hub-viewer-a-1234");
  assert.equal(wrongWorkspaceRemoval.response.status, 200, JSON.stringify(wrongWorkspaceRemoval.payload));
  assert.equal(wrongWorkspaceRemoval.payload.alreadyAbsent, true);
  assert.equal((await memberRequest("/api/auth/me", viewerJwt)).status, 200, "wrong-workspace deprovision must not affect the member");

  const ownerRemoval = await deprovisionMember("hub-org-a-1234", "hub-user-a-1234");
  assert.equal(ownerRemoval.response.status, 409, "Hub team revocation must never remove the Tiquet owner/admin");

  const removedViewer = await deprovisionMember("hub-org-a-1234", "hub-viewer-a-1234");
  assert.equal(removedViewer.response.status, 200, JSON.stringify(removedViewer.payload));
  assert.equal(removedViewer.payload.deprovisioned, true);
  assert.equal(removedViewer.payload.organizationId, "hub-org-a-1234");
  assert.equal((await memberRequest("/api/auth/me", viewerJwt)).status, 401, "existing JWT must stop working immediately after deprovision");

  const repeatedRemoval = await deprovisionMember("hub-org-a-1234", "hub-viewer-a-1234");
  assert.equal(repeatedRemoval.response.status, 200);
  assert.equal(repeatedRemoval.payload.alreadyAbsent, true);

  const repeatedA = await provision("hub-org-a-1234", "Tiquet Business A", "hub-user-a-1234", email);
  assert.equal(repeatedA.accountId, a.accountId, "provisioning must be idempotent for the same workspace");
  assert.equal(repeatedA.userId, a.userId, "owner identity must be stable for the same workspace");

  const summaryA = await platformRequest("/api/platform/summary/hub-org-a-1234");
  const summaryB = await platformRequest("/api/platform/summary/hub-org-b-1234");
  assert.equal(summaryA.response.status, 200, JSON.stringify(summaryA.payload));
  assert.equal(summaryB.response.status, 200, JSON.stringify(summaryB.payload));
  assert.equal(summaryA.payload.account.name, "Tiquet Business A");
  assert.equal(summaryB.payload.account.name, "Tiquet Business B");
  assert.notEqual(summaryA.payload.subjectId, summaryB.payload.subjectId);

  // Phase 2C signing is explicitly disabled unless separately released.
  // Even the normal Hub HMAC may never enable it accidentally.
  const evidenceRequest = JSON.stringify({
    organizationId: "hub-org-a-1234", requestId: "01234567-89ab-4cde-8000-0123456789ab",
  });
  const signedDisabled = await platformRequest("/api/platform/evidence/signed", {
    method: "POST", body: evidenceRequest,
  });
  assert.equal(signedDisabled.response.status, 404,
    "source signing must remain disabled in default test environment");
  const unsignedEvidence = await fetch(base + "/api/platform/evidence/signed", {
    method: "POST", headers: { "content-type": "application/json" },
    body: evidenceRequest,
  });
  assert.equal(unsignedEvidence.status, 401,
    "a caller without the Hub platform signature cannot obtain evidence");
  const wrongPlatformSignature = await fetch(base + "/api/platform/evidence/signed", {
    method: "POST", headers: {
      "content-type": "application/json", "x-v79-service-id": "v79-hub",
      "x-v79-timestamp": String(Date.now()), "x-v79-signature": "f".repeat(64),
    }, body: evidenceRequest,
  });
  assert.equal(wrongPlatformSignature.status, 401);

  const unsigned = await fetch(base + "/api/platform/provision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(unsigned.status, 401);

  console.log("Tiquet platform provisioning isolation: PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
