// Dedicated local synthetic fixture API for the Phase 3 React workbench.
// NOT imported by Tiquet production server; never uses real auth, providers or data.
import express from "express";
import {createServer} from "node:http";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createSupportRouter} from "../../server/support/router.js";
import {createSyntheticMailService} from "../../server/support/syntheticMail.js";
import {requireMailSandbox} from "../../server/support/mailContracts.js";
import {createPhase4Service} from "../../server/support/phase4Service.js";
import {createPhase4Router} from "../../server/support/phase4Router.js";

requireMailSandbox(process.env);
if(process.env.CI_SUPPORT_UI_FIXTURE!=="1"||process.env.V79_SUPPORT_DESK_ENABLED!=="0")
 throw new Error("SUPPORT_UI_FIXTURE_OPT_IN_REQUIRED");
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=="127.0.0.1"||url.pathname!=="/tiquet_support_test")
 throw new Error("SUPPORT_UI_FIXTURE_DB_REFUSED");
const pool=new pg.Pool({connectionString:url.toString(),max:4});
const db={
 query:(s,v)=>pool.query(s,v),
 transaction:fn=>async()=>{
  const client=await pool.connect();
  try{await client.query("BEGIN");const result=await fn({query:(s,v)=>client.query(s,v)});
   await client.query("COMMIT");return result;
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
 }
};
const root=path.dirname(fileURLToPath(import.meta.url));
async function fixtureSetup(){
 await pool.query("CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)");
 await pool.query("CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,account_id TEXT,role TEXT,permissions TEXT)");
 await pool.query("CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,account_id TEXT)");
 await pool.query("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,account_id TEXT,status TEXT,amount INTEGER)");
 await pool.query(await fs.readFile(path.resolve(root,"../../server/support/schema.sql"),"utf8"));
 await pool.query(await fs.readFile(path.resolve(root,"../../server/support/mail-schema.sql"),"utf8"));
 await pool.query(await fs.readFile(path.resolve(root,"../../server/support/phase4-schema.sql"),"utf8"));
 await pool.query("INSERT INTO accounts(id) VALUES('demoA') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO support_sla_policies(account_id,timezone,start_minute,end_minute) "+
  "VALUES('demoA','America/St_Lucia',540,1020) ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO users VALUES('agentA','demoA','Admin','[]') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO clients VALUES('synthetic-client','demoA') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO jobs VALUES('demoJobA','demoA','in-progress',100) ON CONFLICT DO NOTHING");
 await pool.query(
  "INSERT INTO support_mailboxes(id,account_id,address) VALUES('demoMailbox','demoA','help@example.invalid') ON CONFLICT DO NOTHING");
 const fake={kind:"synthetic-mail-provider",send:async()=>({state:"accepted",receipt:"mock-accepted-ui"})};
 const mail=createSyntheticMailService({db,transport:fake});
 const incoming=(key,extra={})=>({
  mailboxId:"demoMailbox",providerUid:"demo-"+key,
  messageId:"<"+key+"@example.invalid>",from:"customer@example.invalid",
  subject:"Synthetic customer support request "+key,
  body:"This message is fictional and is used to test the Tiquet workbench.",
  authenticatedSender:true,references:[],...extra
 });
 // On an empty fixture database only. Never reseed duplicate messages.
 const count=await pool.query("SELECT count(*)::int AS n FROM support_tickets WHERE account_id='demoA'");
 if(count.rows[0].n===0){
  const a=await mail.ingest("demoA",incoming("fiber-offline",
   {subject:"Fiber connection offline — synthetic branch",body:"Our test connection has been down since morning. Please investigate."}));
  await mail.ingest("demoA",incoming("fiber-reply",{
   references:["<fiber-offline@example.invalid>"],
   body:"The synthetic connection is still unavailable."
  }));
  const b=await mail.ingest("demoA",incoming("portal-access",{
   subject:"Unable to sign in to test customer portal",body:"I cannot log in to the synthetic portal."
  }));
  const c=await mail.ingest("demoA",incoming("billing-query",{
   subject:"Clarification on test invoice",body:"Can you explain this synthetic invoice?"
  }));
  await pool.query("UPDATE support_tickets SET assigned_to='agentA',status='open',priority='high' WHERE id=$1",[a.ticketId]);
  await pool.query("UPDATE support_tickets SET assigned_to='agentA',status='waiting_customer',priority='normal' WHERE id=$1",[b.ticketId]);
  await pool.query("UPDATE support_tickets SET assigned_to=NULL,status='new',priority='low' WHERE id=$1",[c.ticketId]);
  await pool.query("INSERT INTO support_ticket_links(account_id,ticket_id,job_id,created_by) "+
    "VALUES('demoA',$1,'demoJobA','agentA') ON CONFLICT DO NOTHING",[a.ticketId]);
  await mail.queueReply({accountId:"demoA",actorId:"agentA",ticketId:a.ticketId,
   mailboxId:"demoMailbox",recipient:"customer@example.invalid",
   body:"This is an accepted mock reply, not a real email.",
   idempotencyKey:"demo_reply_accepted_01"});
  await mail.dispatchOne();
  const another=await mail.queueReply({accountId:"demoA",actorId:"agentA",ticketId:b.ticketId,
   mailboxId:"demoMailbox",recipient:"customer@example.invalid",
   body:"This message has an uncertain test delivery state.",
   idempotencyKey:"demo_reply_uncertain_01"});
  await pool.query("UPDATE support_outbox SET state='uncertain',error_code='SYNTHETIC_TIMEOUT' WHERE id=$1",[another.outboxId]);
  await pool.query("UPDATE support_messages SET delivery_state='uncertain' WHERE id=$1",[another.messageId]);
 }
}
const fixtureAuth=(req,res,next)=>{
 if(req.headers["x-synthetic-user"]!=="agentA"||req.headers["x-synthetic-account"]!=="demoA")
  return res.status(401).json({code:"FIXTURE_IDENTITY_REQUIRED",error:"Synthetic identity required"});
 req.user={id:"agentA",account_id:"demoA"};
 req.accountId="demoA";next();
};
const app=express();
app.disable("x-powered-by");
app.use(express.json({limit:"16kb"}));
app.get("/sandbox/health",(req,res)=>res.json({synthetic:true,mailProvider:"mock",production:false}));
const phase4=createPhase4Service({db});
app.use("/api/support/staff/phase4",createPhase4Router({db,authenticateToken:fixtureAuth,service:phase4}));
app.use("/api/support/staff",createSupportRouter({db,authenticateToken:fixtureAuth,phase4Hooks:phase4}));
await fixtureSetup();
const listener=createServer(app);
await new Promise(resolve=>listener.listen(3088,"127.0.0.1",resolve));
console.log("SUPPORT_UI_FIXTURE_READY localhost:3088 synthetic_only=true");
async function stop(){
 await new Promise(resolve=>listener.close(resolve));await pool.end();
}
process.on("SIGTERM",()=>{void stop().then(()=>process.exit(0));});
process.on("SIGINT",()=>{void stop().then(()=>process.exit(0));});
