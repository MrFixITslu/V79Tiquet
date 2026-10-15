import test from "node:test";
import assert from "node:assert/strict";
import { authorizeTiquetStaffSocket, revalidateTiquetStaffSocket } from "../server/tiquetSocketAccess.js";

const NOW = Date.now();
const currentJwt = {
  id: "staff", account_id: "tenant-a", exp: Math.floor(NOW / 1000) + 900,
  hub_managed: true, hub_organization_id: "org-a",
};
const signatureHash = "a".repeat(64);
function fakeDb({ managed = true, active = true, linked = true, broken = false } = {}) {
  const org = managed ? "org-a" : null;
  return {
    prepare(sql) {
      if (broken) throw Error("synthetic database outage");
      return { async get(...args) {
        if (sql.includes("FROM users"))
          return args[0] === "staff" && args[1] === "tenant-a"
            ? { id: "staff", hub_user_id: linked && managed ? "scoped-a" : null } : null;
        if (sql.includes("FROM accounts"))
          return args[0] === "tenant-a"
            ? { status: active ? "active" : "suspended", hub_organization_id: org } : null;
        if (sql.includes("FROM revoked_auth_tokens")) return null;
        throw Error("Unexpected statement in isolated test");
      } };
    }
  };
}
const enforce = async identity => identity.organizationId === "org-a" && identity.scopedUserId === "scoped-a";
const socket = identity => ({
  role: "staff", tokenHash: signatureHash, jwtExpiresAt: NOW + 900_000,
  sessionIdentity: { userId: "staff", accountId: "tenant-a" },
  hubIdentity: identity,
});

test("Hub-enforced staff WebSockets reject an unlinked legacy account", async () => {
  const result = await authorizeTiquetStaffSocket({
    decoded: { ...currentJwt, hub_managed: false, hub_organization_id: null },
    db: fakeDb({ managed: false }), checkHubSubscription: enforce
  });
  assert.equal(result.allowed, false);
});

test("Hub checker cannot be skipped through missing org, missing linked user or suspended membership", async () => {
  for (const db of [fakeDb({ linked: false }), fakeDb({ active: false })]) {
    const result = await authorizeTiquetStaffSocket({
      decoded: currentJwt, db, checkHubSubscription: enforce
    });
    assert.equal(result.allowed, false);
  }
  const result = await authorizeTiquetStaffSocket({
    decoded: { ...currentJwt, hub_organization_id: "org-b" },
    db: fakeDb(), checkHubSubscription: enforce,
  });
  assert.equal(result.allowed, false);
});

test("valid linked Hub staff still connects when subscription is verified", async () => {
  const result = await authorizeTiquetStaffSocket({
    decoded: currentJwt, db: fakeDb(), checkHubSubscription: enforce,
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.hubIdentity, { organizationId: "org-a", scopedUserId: "scoped-a" });
});

test("explicitly unconfigured Hub-enforcement mode preserves historical local staff behavior", async () => {
  const result = await authorizeTiquetStaffSocket({
    decoded: { ...currentJwt, hub_managed: false, hub_organization_id: null },
    db: fakeDb({ managed: false }), checkHubSubscription: null,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.hubIdentity, null);
  assert.equal(await revalidateTiquetStaffSocket(socket(null), null, NOW, fakeDb({ managed: false })), true);
});

test("legacy staff socket cannot survive enforcement becoming active on a heartbeat", async () => {
  const ws = socket(null);
  assert.equal(await revalidateTiquetStaffSocket(ws, enforce, NOW, fakeDb({ managed: false })), false);
  assert.equal(await revalidateTiquetStaffSocket(ws, enforce, NOW, fakeDb({ broken: true })), false);
  assert.equal(await revalidateTiquetStaffSocket(ws, enforce, NOW, fakeDb()), false);
});

test("valid linked socket still requires active local account, JWT time and live entitlement", async () => {
  const ws = socket({ organizationId: "org-a", scopedUserId: "scoped-a" });
  assert.equal(await revalidateTiquetStaffSocket(ws, enforce, NOW, fakeDb()), true);
  assert.equal(await revalidateTiquetStaffSocket(ws, async () => false, NOW, fakeDb()), false);
  assert.equal(await revalidateTiquetStaffSocket(ws, enforce, NOW, fakeDb({active:false})), false);
  assert.equal(await revalidateTiquetStaffSocket(ws, enforce, NOW, fakeDb({broken:true})), false);
  assert.equal(await revalidateTiquetStaffSocket(ws, enforce, NOW + 900_001, fakeDb()), false);
});

test("client secure-link sockets use their separate policy (not staff Hub subscription auth)", async () => {
  assert.equal(await revalidateTiquetStaffSocket({role:"client"},enforce,NOW,fakeDb()),true);
});
