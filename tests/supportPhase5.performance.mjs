// Synthetic-only latency characterization. Never runs against a non-local DB.
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {createServer} from "node:http";
import pg from "pg";
import express from "express";
import {createSupportRouter} from "../server/support/router.js";
const u=new URL(process.env.DATABASE_URL||"postgresql://invalid/invalid");
if(process.env.CI_SUPPORT_SYNTHETIC!=="1"||process.env.NODE_ENV!=="test"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0"||
 u.hostname!=="127.0.0.1"||u.pathname!=="/tiquet_support_test")
 throw Error("PERFORMANCE_STOP_DISPOSABLE_ONLY");
const pool=new pg.Pool({connectionString:u.toString(),max:5});
const db={
 query:(q,p)=>pool.query(q,p),
 transaction:fn=>async()=>{
  const c=await pool.connect();
  try{await c.query("BEGIN");const r=await fn({query:(q,p)=>c.query(q,p)});
   await c.query("COMMIT");return r;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
};
const app=express();app.use(express.json());
app.use("/api/support/staff",createSupportRouter({db,authenticateToken:(req,res,next)=>{
 req.accountId="perfA";req.user={id:"perfAgent"};next();
}}));
const http=createServer(app);
try{
 await pool.query("INSERT INTO accounts(id) VALUES('perfA') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO users(id,account_id,role,permissions) "+
  "VALUES('perfAgent','perfA','Admin','[]') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO support_tickets(id,account_id,subject,status,priority,created_by) "+
  "SELECT 'perf_'||lpad(n::text,6,'0'),'perfA','Synthetic performance ticket '||n,"+
  "'open','normal','perfAgent' FROM generate_series(1,15000) AS n "+
  "ON CONFLICT DO NOTHING");
 await new Promise(resolve=>http.listen(0,"127.0.0.1",resolve));
 const port=http.address().port,base="http://127.0.0.1:"+port;
 const latencies=[],ids=new Set();
 let cursor=null;
 for(let i=0;i<60;i++){
  const suffix="?limit=25&status=open"+(cursor?"&cursor="+encodeURIComponent(cursor):"");
  const start=performance.now();
  const response=await fetch(base+"/api/support/staff/tickets"+suffix,{
   signal:AbortSignal.timeout(4000)});
  const ms=performance.now()-start;
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.items.length,25);
  for(const item of body.items){
   assert.equal(item.accountId,"perfA");assert.equal(ids.has(item.id),false);
   ids.add(item.id);
  }
  assert.ok(body.nextCursor);cursor=body.nextCursor;
  latencies.push(ms);
 }
 const sorted=[...latencies].sort((a,b)=>a-b);
 const p95=sorted[Math.ceil(.95*sorted.length)-1];
 assert.equal(ids.size,1500);
 // This is a generous CI safeguard, not a production SLO measurement.
 assert.ok(p95<2000,"Synthetic queue p95 >= 2000ms: "+p95.toFixed(1));
 const badSearch=await fetch(base+"/api/support/staff/tickets?search="+
  encodeURIComponent("%' OR TRUE --"));
 assert.equal(badSearch.status,200);
 assert.equal((await badSearch.json()).items.length,0);
 const tooMany=await fetch(base+"/api/support/staff/tickets?limit=1000000");
 assert.equal(tooMany.status,400);
 console.log("SUPPORT_P5_SYNTHETIC_15K_PAGINATION=PASS");
 console.log("SUPPORT_P5_LOCAL_CI_P95_MS="+p95.toFixed(1));
 console.log("SUPPORT_P5_CI_LATENCY_IS_NOT_PRODUCTION_SLO=true");
}finally{
 await new Promise(resolve=>http.close(resolve));await pool.end();
}
