"use strict";
// Strictly gated: real PostgreSQL/WebSocket E2E on disposable GitHub CI only.
// Never run against a customer database or live V79 endpoints.
const assert = require("node:assert/strict");
const {randomUUID,randomBytes} = require("node:crypto");
const {Pool} = require("pg");
const WebSocket = require("ws");
const REQUIRED_DB = "postgresql://tiquet_test:tiquet_test_password@127.0.0.1:5432/tiquet_test";
if (process.env.GITHUB_ACTIONS !== "true" ||
    process.env.NODE_ENV !== "test" ||
    process.env.DATABASE_URL !== REQUIRED_DB ||
    process.env.V79_ALLOW_LEGACY_AUTH !== "0" ||
    process.env.JWT_SECRET !== "ci_jwt_secret_0123456789abcdef0123456789abcdef") {
  throw new Error("REFUSING_NON_CI_PORTAL_WEBSOCKET_TEST");
}
const pool=new Pool({connectionString:REQUIRED_DB});
const base="ws://127.0.0.1:3000/ws";
const accounts=[];
const jobs=[];
const clients=[];
async function ready(){
  let last;
  for(let n=0;n<90;n++){
    try {
      const result=await pool.query("SELECT 1 FROM jobs LIMIT 1");
      const response=await fetch("http://127.0.0.1:3000/health",{signal:AbortSignal.timeout(1000)});
      if(response.ok && result) return;
    }catch(e){last=e;}
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error("Synthetic test Tiquet and PostgreSQL were not ready: "+(last?.message||"unknown"));
}
async function seed(label){
  const account="ci-portal-account-"+label+"-"+randomUUID();
  const job="ci-portal-job-"+label+"-"+randomUUID();
  const token=randomBytes(32).toString("base64url");
  const expires=new Date(Date.now()+30*60*1000).toISOString();
  await pool.query("INSERT INTO accounts(id,name,createdAt,status) VALUES($1,$2,$3,'active')",
    [account,"Isolated "+label,new Date().toISOString()]);
  accounts.push(account);
  await pool.query(
    "INSERT INTO jobs(id,title,client,status,createdAt,priority,account_id,secureToken,secureTokenExpires,secureTokenRevokedAt) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)",
    [job,"Synthetic websocket "+label,"Fake Client","Open",new Date().toISOString(),"Medium",account,token,expires]);
  jobs.push(job);
  return {account,job,token};
}
async function connect(token){
  const ws=new WebSocket(base+"?token="+encodeURIComponent(token),{handshakeTimeout:5000});
  clients.push(ws);
  await Promise.race([
    new Promise((resolve,reject)=>{
      ws.once("open",resolve);
      ws.once("error",reject);
      ws.once("close",(code)=>reject(new Error("Portal socket closed before open: "+code)));
    }),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error("WebSocket open timeout")),6000)),
  ]);
  await new Promise(r=>setTimeout(r,250)); // Allow async connection authorization to complete.
  assert.equal(ws.readyState,WebSocket.OPEN);
  return ws;
}
async function closedWithinHeartbeat(ws,reason){
  const result=await Promise.race([
    new Promise((resolve,reject)=>{
      if(ws.readyState===WebSocket.CLOSED)return resolve({code:4003});
      ws.once("close",(code)=>resolve({code}));
      ws.once("error",reject);
    }),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(reason+" did not close within bounded heartbeat")),25000)),
  ]);
  assert.equal(result.code,4003,reason);
}
async function main(){
  await ready();
  const a=await seed("a"),b=await seed("b");
  const aSocket=await connect(a.token);
  const bSocket=await connect(b.token);
  await pool.query("UPDATE jobs SET secureTokenRevokedAt=$1 WHERE id=$2 AND account_id=$3",
    [new Date().toISOString(),a.job,a.account]);
  await closedWithinHeartbeat(aSocket,"revoked tenant A");
  assert.equal(bSocket.readyState,WebSocket.OPEN,"Revoking A must not evict B");
  const bNext=randomBytes(32).toString("base64url");
  await pool.query("UPDATE jobs SET secureToken=$1 WHERE id=$2 AND account_id=$3",
    [bNext,b.job,b.account]);
  await closedWithinHeartbeat(bSocket,"rotated tenant B");
  const bNewSocket=await connect(bNext);
  await pool.query("UPDATE accounts SET status='suspended' WHERE id=$1",[b.account]);
  await closedWithinHeartbeat(bNewSocket,"suspended tenant B");
  console.log("PASS disposable PG/WebSocket: A revoked, B unaffected, B rotation closes old token, new token closes on account suspension");
}
(async()=>{try{await main();}finally{
  for(const socket of clients){try{socket.terminate();}catch{}}
  if(jobs.length)await pool.query("DELETE FROM jobs WHERE id=ANY($1::text[])",[jobs]);
  if(accounts.length)await pool.query("DELETE FROM accounts WHERE id=ANY($1::text[])",[accounts]);
  await pool.end();
}})().catch(e=>{console.error("FAIL isolated portal WebSocket integration:",e.message);process.exitCode=1;});
