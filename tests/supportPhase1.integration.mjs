import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import path from "node:path";
import pg from "pg";
import express from "express";
import {createSupportRouter} from "../server/support/router.js";

// HARD STOP before touching a database: localhost, known fixture DB, opt-in.
const uri=new URL(process.env.DATABASE_URL||"postgres://invalid/invalid");
if(process.env.CI_SUPPORT_SYNTHETIC!=="1"||process.env.NODE_ENV!=="test"||
 !["127.0.0.1","localhost"].includes(uri.hostname)||uri.pathname!=="/tiquet_support_test")
 throw new Error("SUPPORT_TEST_STOP_DISPOSABLE_LOCAL_DATABASE_REQUIRED");
const pool=new pg.Pool({connectionString:uri.toString(),max:3});
const db={
 query:(sql,values)=>pool.query(sql,values),
 transaction:fn=>async()=> {
  const client=await pool.connect();
  try {
   await client.query("BEGIN");
   const result=await fn({query:(sql,values)=>client.query(sql,values)});
   await client.query("COMMIT");return result;
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 }
};
const fixtureAuth=(req,res,next)=>{
 const account=req.headers["x-synthetic-account"],user=req.headers["x-synthetic-user"];
 if(!account||!user) return res.status(401).json({error:"synthetic auth required"});
 req.accountId=account;req.user={id:user,account_id:account};next();
};
const app=express();app.use(express.json({limit:"16kb"}));
app.use("/api/support/staff",createSupportRouter({db,authenticateToken:fixtureAuth}));
const server=createServer(app);
let base;
const send=async(path,account="teamA",user="ownerA",method="GET",body,headers={})=>{
 const response=await fetch(base+path,{method,headers:{
  "Content-Type":"application/json","x-synthetic-account":account,
  "x-synthetic-user":user,...headers
 },body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await response.text();
 let json;try{json=JSON.parse(raw);}catch{json={raw};}
 return {status:response.status,body:json,etag:response.headers.get("etag")};
};
test.before(async()=>{
 await pool.query("CREATE TABLE accounts(id TEXT PRIMARY KEY)");
 await pool.query("CREATE TABLE users(id TEXT PRIMARY KEY,account_id TEXT,role TEXT,permissions TEXT)");
 await pool.query("CREATE TABLE clients(id TEXT PRIMARY KEY,account_id TEXT)");
 await pool.query("CREATE TABLE jobs(id TEXT PRIMARY KEY,account_id TEXT,status TEXT,amount INTEGER)");
 const root=path.dirname(fileURLToPath(import.meta.url));
 const ddl=await fs.readFile(path.resolve(root,"../server/support/schema.sql"),"utf8");
 await pool.query(ddl);await pool.query(ddl); // idempotent migration rehearsal
 await pool.query("INSERT INTO accounts(id) VALUES('teamA'),('teamB')");
 await pool.query("INSERT INTO users VALUES('ownerA','teamA','Admin','[]'),"+
  "('staffA','teamA','Member','[\"support.view\",\"support.create\",\"support.note\",\"support.update\",\"support.link\"]'),"+
  "('viewerA','teamA','Member','[\"support.view\"]'),"+
  "('legacyA','teamA','Member','[\"jobs\"]'),"+
  "('ownerB','teamB','Admin','[]')");
 await pool.query("INSERT INTO clients VALUES('clientA','teamA'),('clientB','teamB')");
 await pool.query("INSERT INTO jobs VALUES('jobA','teamA','in-progress',100),('jobB','teamB','paid',500)");
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 base="http://127.0.0.1:"+server.address().port;
});
test.after(async()=>{
 await new Promise(resolve=>server.close(resolve));await pool.end();
});
test("Phase1 API: scope, idempotency, ETags, notes and links",async()=>{
 const h={"Idempotency-Key":"synthetic_create_100"};
 const create=await send("/api/support/staff/tickets","teamA","ownerA","POST",
  {subject:"Synthetic network issue",clientId:"clientA",assignedTo:"staffA",priority:"high"},h);
 assert.equal(create.status,201,JSON.stringify(create));
 const ticket=create.body.id;
 assert.ok(ticket);
 const repeat=await send("/api/support/staff/tickets","teamA","ownerA","POST",
  {subject:"Synthetic network issue",clientId:"clientA",assignedTo:"staffA",priority:"high"},h);
 assert.equal(repeat.status,200);assert.equal(repeat.body.id,ticket);
 const conflict=await send("/api/support/staff/tickets","teamA","ownerA","POST",
  {subject:"Other issue"},h);
 assert.equal(conflict.status,409);
 const foreign=await send("/api/support/staff/tickets/"+ticket,"teamB","ownerB");
 assert.equal(foreign.status,404);
 const legacy=await send("/api/support/staff/tickets","teamA","legacyA");
 assert.equal(legacy.status,403);
 const viewer=await send("/api/support/staff/tickets","teamA","viewerA");
 assert.equal(viewer.status,200);
 const noIf=await send("/api/support/staff/tickets/"+ticket,"teamA","ownerA","PATCH",
  {status:"open"});
 assert.equal(noIf.status,428);
 const patch=await send("/api/support/staff/tickets/"+ticket,"teamA","ownerA","PATCH",
  {status:"open"},{"If-Match":create.etag});
 assert.equal(patch.status,200);assert.equal(patch.body.version,2);
 const stale=await send("/api/support/staff/tickets/"+ticket,"teamA","ownerA","PATCH",
  {status:"resolved"},{"If-Match":create.etag});
 assert.equal(stale.status,412);
 const noteH={"Idempotency-Key":"synthetic_note_100"};
 const note=await send("/api/support/staff/tickets/"+ticket+"/messages","teamA","staffA","POST",
  {body:"Synthetic internal note",visibility:"internal"},noteH);
 assert.equal(note.status,201,JSON.stringify(note));assert.equal(note.body.deliveryState,"not_applicable");
 const noteReplay=await send("/api/support/staff/tickets/"+ticket+"/messages","teamA","staffA","POST",
  {body:"Synthetic internal note",visibility:"internal"},noteH);
 assert.equal(noteReplay.status,200);assert.equal(noteReplay.body.id,note.body.id);
 const noSend=await send("/api/support/staff/tickets/"+ticket+"/messages","teamA","staffA","POST",
  {body:"Do not send this",visibility:"public"},{"Idempotency-Key":"synthetic_reply_100"});
 assert.equal(noSend.status,409);assert.equal(noSend.body.code,"OUTBOUND_NOT_ENABLED");
 const view=await send("/api/support/staff/tickets/"+ticket+"/messages","teamA","viewerA");
 assert.equal(view.status,200);assert.equal(view.body.items.length,0);
 const staffView=await send("/api/support/staff/tickets/"+ticket+"/messages","teamA","staffA");
 assert.equal(staffView.body.items.length,1);
 const wrongJob=await send("/api/support/staff/tickets/"+ticket+"/links","teamA","staffA",
  "POST",{kind:"service_job",targetId:"jobB"});
 assert.equal(wrongJob.status,400);
 const goodJob=await send("/api/support/staff/tickets/"+ticket+"/links","teamA","staffA",
  "POST",{kind:"service_job",targetId:"jobA"});
 assert.equal(goodJob.status,201);
 const job=await pool.query("SELECT status,amount FROM jobs WHERE id='jobA'");
 assert.deepEqual(job.rows[0],{status:"in-progress",amount:100});
});
test("cursor pagination is tenant scoped and bounded",async()=>{
 for(let i=0;i<5;i++){
  const c=await send("/api/support/staff/tickets","teamA","ownerA","POST",
    {subject:"Synthetic paged issue "+i},{"Idempotency-Key":"pagination_"+i+"_0001"});
  assert.equal(c.status,201);
 }
 const a=await send("/api/support/staff/tickets?limit=2","teamA","ownerA");
 assert.equal(a.status,200);assert.equal(a.body.items.length,2);assert.ok(a.body.nextCursor);
 const b=await send("/api/support/staff/tickets?limit=2&cursor="+a.body.nextCursor,"teamA","ownerA");
 assert.equal(b.status,200);assert.equal(b.body.items.length,2);
 assert.equal(new Set([...a.body.items,...b.body.items].map(x=>x.id)).size,4);
 const mismatch=await send("/api/support/staff/tickets?limit=2&status=open&cursor="+
   a.body.nextCursor,"teamA","ownerA");
 assert.equal(mismatch.status,400);
 const noTenantRows=await send("/api/support/staff/tickets","teamB","ownerB");
 assert.deepEqual(noTenantRows.body.items,[]);
});

test("10,000 synthetic tickets remain bounded behind server pagination",async()=>{
 await pool.query("INSERT INTO support_tickets(id,account_id,subject,status,priority) "+
  "SELECT 'bulk_'||lpad(n::text,6,'0'),'teamA','Synthetic bulk issue '||n,"+
  "'new','normal' FROM generate_series(1,10000) AS n");
 const first=await send("/api/support/staff/tickets?limit=25","teamA","ownerA");
 assert.equal(first.status,200);
 assert.equal(first.body.items.length,25);
 assert.ok(first.body.nextCursor);
 const next=await send("/api/support/staff/tickets?limit=25&cursor="+
  encodeURIComponent(first.body.nextCursor),"teamA","ownerA");
 assert.equal(next.status,200);
 assert.equal(next.body.items.length,25);
 assert.equal(new Set([...first.body.items,...next.body.items].map(i=>i.id)).size,50);
 const oversize=await send("/api/support/staff/tickets?limit=101","teamA","ownerA");
 assert.equal(oversize.status,400);
 const other=await send("/api/support/staff/tickets?limit=25","teamB","ownerB");
 assert.deepEqual(other.body.items,[]);
});
