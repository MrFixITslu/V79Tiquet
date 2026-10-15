"use strict";
// Real disposable PostgreSQL + WebSocket test of production portal-guard module.
// THIS IS NOT a test of the full live Tiquet server or Hub handshake.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const pg = require("pg");
const WebSocket = require("ws");
const { once } = require("node:events");

const ONLY_TEST_DB = "postgresql://tiquet_test:tiquet_test_password@127.0.0.1:5432/tiquet_test";
if (process.env.GITHUB_ACTIONS !== "true" || process.env.NODE_ENV !== "test" ||
    process.env.DATABASE_URL !== ONLY_TEST_DB ||
    process.env.CI_PORTAL_REVOKE_TEST !== "1") {
  throw new Error("REFUSING_NON_DISPOSABLE_WS_POSTGRES");
}
const { tokenFingerprint } = await import("../server/tokenRevocation.js");
const { revalidateTiquetPortalSocket } = await import("../server/tiquetPortalSocketAccess.js");
const pool = new pg.Pool({ connectionString: ONLY_TEST_DB, max: 5, connectionTimeoutMillis: 3000 });
const ids = ["tenant-a-" + randomUUID(), "tenant-b-" + randomUUID()];
const links = ["job-a-" + randomUUID(), "job-b-" + randomUUID()];
const tokens = ["A".repeat(43), "B".repeat(43)];
let server, wsServer;

const db = { prepare(query) {
  if (!query.startsWith("SELECT ")) throw Error("Unexpected SQL");
  return { async get(...args) {
    // Number placeholders in appearance order, independent of argument values.
    let n = 0;
    const numbered = query.replace(/\?/g, () => "$" + ++n);
    const r = await pool.query(numbered, args);
    return r.rows[0] || null;
  }};
}};

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function liveSocket(jobId, tenantId, token) {
  const current = { role:"client", portalSession: {
    jobId, accountId:tenantId, tokenHash:tokenFingerprint(token),
  }};
  const first = await revalidateTiquetPortalSocket(current, db);
  assert.equal(first, true, "Expected isolated DB-backed initial access");
  // WS has no credentials in URL; the test binds immutable scope on the server.
  const client = new WebSocket("ws://127.0.0.1:" + server.address().port + "/");
  await once(client, "open");
  client.on("error", () => {});
  const ws = [...wsServer.clients].at(-1);
  ws.role = "client"; ws.portalSession = current.portalSession;
  const closeResult = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("WebSocket did not close")), 3000);
    client.once("close", (code) => { clearTimeout(timeout); resolve(code); });
  });
  return {ws, client, closeResult};
}
async function tick(ws) {
  if (!(await revalidateTiquetPortalSocket(ws, db, Date.now())))
    ws.close(4003, "Portal link no longer authorized");
}
async function setJob(jobId, updates) {
  const fields = Object.keys(updates);
  await pool.query(
    "UPDATE jobs SET " + fields.map((k,i) => '"' + k + '"=$' + (i+1)).join(",") +
    " WHERE id=$" + (fields.length+1),
    [...Object.values(updates), jobId]
  );
}
(async () => {
  const expires = new Date(Date.now() + 60000).toISOString();
  try {
    await pool.query("CREATE TEMP TABLE IF NOT EXISTS isolated_marker(x int)"); // Connection smoke only.
    for(const [i,id] of ids.entries()){
      await pool.query("INSERT INTO accounts(id,name,createdAt,status) VALUES($1,$2,$3,'active')",
        [id,"Synthetic Portal DB Test",new Date().toISOString()]);
      await pool.query(
        'INSERT INTO jobs(id,title,client,status,createdAt,priority,account_id,"secureToken","secureTokenExpires") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [links[i],"Synthetic Job","Synthetic","New",new Date().toISOString(),"Normal",id,tokens[i],expires]);
    }
    server=createServer();
    wsServer=new WebSocket.WebSocketServer({server});
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    const a=await liveSocket(links[0],ids[0],tokens[0]);
    const b=await liveSocket(links[1],ids[1],tokens[1]);
    // Unauthorized cross-tenant signed link is rejected before attaching.
    assert.equal(await revalidateTiquetPortalSocket({
      role:"client",portalSession:{jobId:links[0],accountId:ids[1],tokenHash:tokenFingerprint(tokens[0])}
    },db),false);

    await setJob(links[0], {secureToken:"C".repeat(43)});
    await tick(a.ws);
    assert.equal(await a.closeResult,4003);
    assert.equal(await revalidateTiquetPortalSocket(b.ws,db),true,"Other tenant unaffected");

    await setJob(links[1], {secureTokenRevokedAt:new Date().toISOString()});
    await tick(b.ws);
    assert.equal(await b.closeResult,4003);

    await setJob(links[0],{secureToken:tokens[0],secureTokenRevokedAt:null,
      secureTokenExpires:new Date(Date.now() - 1000).toISOString()});
    assert.equal(await revalidateTiquetPortalSocket({
      role:"client",portalSession:{jobId:links[0],accountId:ids[0],tokenHash:tokenFingerprint(tokens[0])}
    },db),false,"Expired link must deny");

    await setJob(links[0],{secureTokenExpires:expires});
    await pool.query("UPDATE accounts SET status='suspended' WHERE id=$1",[ids[0]]);
    assert.equal(await revalidateTiquetPortalSocket({
      role:"client",portalSession:{jobId:links[0],accountId:ids[0],tokenHash:tokenFingerprint(tokens[0])}
    },db),false,"Suspended account must deny");

    console.log("PASS: disposable PostgreSQL / ws closed tenant A on rotation and tenant B on revocation, denied expired/suspended/cross-tenant access");
  } finally {
    try { for(const id of links) await pool.query("DELETE FROM jobs WHERE id=$1",[id]); } catch {}
    try { for(const id of ids) await pool.query("DELETE FROM accounts WHERE id=$1",[id]); } catch {}
    if(wsServer)for(const client of wsServer.clients) client.terminate();
    if(wsServer)await new Promise(resolve=>wsServer.close(resolve));
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    await pool.end();
  }
})().catch(err => {console.error("CI_POSTGRES_WS_CONTRACT_FAILED",err.message); process.exitCode=1;});
