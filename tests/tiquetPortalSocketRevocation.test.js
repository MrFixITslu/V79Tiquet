import test from "node:test";
import assert from "node:assert/strict";
import { tokenFingerprint } from "../server/tokenRevocation.js";
import { revalidateTiquetPortalSocket } from "../server/tiquetPortalSocketAccess.js";

const now = Date.parse("2026-10-15T20:00:00Z");
const raw = "C".repeat(43);
const makeSocket = () => ({
  role: "client", portalSession: {
    jobId: "job-1", accountId: "account-1", tokenHash: tokenFingerprint(raw),
  },
});
const makeDb = (overrides = {}) => {
  const state = {
    job: {
      secureToken: raw, secureTokenExpires: "2026-10-15T20:15:00Z",
      secureTokenRevokedAt: null, account_id: "account-1",
    },
    account: {status:"active"}, broken: false, ...overrides,
  };
  const calls = [];
  return {state, calls, prepare(sql) {
    calls.push(sql);
    if (state.broken) throw Error("Simulated DB outage");
    return { async get(...args) {
      if (sql.includes("FROM jobs")) {
        assert.deepEqual(args, ["job-1","account-1"]);
        return state.job;
      }
      if (sql.includes("FROM accounts")) {
        assert.deepEqual(args, ["account-1"]);
        return state.account;
      }
      throw Error("Unexpected DB query");
    }};
  }};
};

test("legitimate unexpired and current scoped portal token is accepted", async () => {
  const db=makeDb();
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),db,now),true);
  assert.equal(db.calls.length,2);
});

test("rotated and explicitly revoked links close existing portal sockets", async () => {
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),makeDb({job:{
    secureToken:"R".repeat(43),secureTokenExpires:"2026-10-15T20:15:00Z",
    secureTokenRevokedAt:null,account_id:"account-1",
  }}),now),false);
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),makeDb({job:{
    secureToken:raw,secureTokenExpires:"2026-10-15T20:15:00Z",
    secureTokenRevokedAt:"2026-10-15T20:00:00Z",account_id:"account-1",
  }}),now),false);
});

test("expiry and invalid expiry close connected sockets without waiting for browser refresh", async () => {
  const db=makeDb();
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),db,Date.parse(db.state.job.secureTokenExpires)),false);
  db.state.job.secureTokenExpires="invalid";
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),db,now),false);
});

test("removed job, remapped tenant or suspended account deny portal socket", async () => {
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),makeDb({job:null}),now),false);
  const wrong = makeDb(); wrong.state.job.account_id = "account-2";
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),wrong,now),false);
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),makeDb({account:{status:"suspended"}}),now),false);
  assert.equal(await revalidateTiquetPortalSocket(makeSocket(),makeDb({account:null}),now),false);
});

test("database outage and missing provenance fail closed, no raw token retained", async () => {
  const ws=makeSocket();
  assert.ok(!JSON.stringify(ws).includes(raw));
  assert.equal(await revalidateTiquetPortalSocket(ws,makeDb({broken:true}),now),false);
  for(const item of [
    {role:"staff",portalSession:ws.portalSession},
    {role:"client",portalSession:undefined},
    {role:"client",portalSession:{...ws.portalSession,tokenHash:"bad"}},
    {role:"client",portalSession:{...ws.portalSession,accountId:""}},
  ]) assert.equal(await revalidateTiquetPortalSocket(item,makeDb(),now),false);
});

test("forged token hash, malformed current stored token and expired socket all denied", async () => {
  const sock=makeSocket();
  assert.equal(await revalidateTiquetPortalSocket({
    ...sock,portalSession:{...sock.portalSession,tokenHash:"0".repeat(64)}
  },makeDb(),now),false);
  assert.equal(await revalidateTiquetPortalSocket(sock,makeDb({job:{
    secureToken:"short", secureTokenExpires:"2026-10-15T20:15:00Z",secureTokenRevokedAt:null,account_id:"account-1"
  }}),now),false);
  assert.equal(await revalidateTiquetPortalSocket(sock,null,now),false);
});
