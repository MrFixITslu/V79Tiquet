// Isolated sanitized offline recovery of linked Hub state, Tiquet PostgreSQL,
// and uploads. This is deliberately NOT production RPO/RTO evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {performance} from "node:perf_hooks";
import {execFileSync} from "node:child_process";
import pg from "pg";

const dbname="tiquet_support_test",restoreName="tiquet_support_release_gates_restore";
const url="postgresql://support_test:support_test_password@127.0.0.1:5432/";
if(process.env.GITHUB_ACTIONS!=="true"||process.env.NODE_ENV!=="test"||
 process.env.CI_SUPPORT_SYNTHETIC!=="1"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0"||
 process.env.V79_ALLOW_PRODUCTION_DEPLOY!=="0"||
 process.env.DATABASE_URL!==url+dbname)
 throw Error("RELEASE_GATES_OFFLINE_RESTORE_REFUSED_NON_SYNTHETIC");
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:"utf8",timeout:90000,
 env:{...process.env,PGHOST:"127.0.0.1",PGPORT:"5432",PGUSER:"support_test",
 PGPASSWORD:"support_test_password"}});
const sum=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"v79-sanitized-paired-"));
const bundle=path.join(temp,"offline-capture"),recover=path.join(temp,"isolated-restore");
fs.mkdirSync(path.join(bundle,"hub"),{recursive:true});
fs.mkdirSync(path.join(bundle,"tiquet","uploads"),{recursive:true});
fs.mkdirSync(recover,{recursive:true});
const db=new pg.Client({connectionString:url+dbname});
let restored;
const started=performance.now();
const close=async c=>{try{await c?.end();}catch{}};
async function checkRestored(where,storeDb){
 const state=JSON.parse(fs.readFileSync(path.join(where,"hub","store.json"),"utf8"));
 const stored=fs.readFileSync(path.join(where,"tiquet","uploads","rg9a-note.txt"),"utf8");
 const mappings=state.organizations.map(o=>o.externalTenantId).sort();
 const rows=(await storeDb.query("SELECT id FROM accounts WHERE id LIKE 'releasegate_%' ORDER BY id"))
  .rows.map(x=>x.id);
 return state.schema==="sanitized-recovery-v1" &&
  mappings.join(",")==="releasegate_a,releasegate_b" &&
  rows.join(",")==="releasegate_a,releasegate_b" &&
  stored==="SYNTHETIC_OFFLINE_NOTE_DO_NOT_EMAIL\n";
}
try{
 await db.connect();
 await db.query("INSERT INTO accounts(id) VALUES('releasegate_a'),('releasegate_b') ON CONFLICT DO NOTHING");
 await db.query("INSERT INTO users(id,account_id,role,permissions) VALUES "+
  "('releasegate_agent','releasegate_a','Admin','[]') ON CONFLICT DO NOTHING");
 await db.query("INSERT INTO jobs(id,account_id,status,amount) VALUES "+
  "('releasegate_job','releasegate_a','invoiced',300) ON CONFLICT DO NOTHING");
 await db.query("INSERT INTO support_tickets(id,account_id,subject,created_by) VALUES "+
  "('releasegate_ticket','releasegate_a','Sanitized offline ticket','releasegate_agent') "+
  "ON CONFLICT DO NOTHING");
 await db.query("INSERT INTO support_ticket_links(account_id,ticket_id,job_id,created_by) VALUES "+
  "('releasegate_a','releasegate_ticket','releasegate_job','releasegate_agent') "+
  "ON CONFLICT DO NOTHING");
 const hub={
  schema:"sanitized-recovery-v1",
  organizations:[
   {id:"sanitized-hub-a",externalTenantId:"releasegate_a",status:"active"},
   {id:"sanitized-hub-b",externalTenantId:"releasegate_b",status:"active"}
  ],users:[{id:"sanitized-agent",org:"sanitized-hub-a"}],
  mailProviders:[],billingProviders:[],liveTokens:[]
 };
 fs.writeFileSync(path.join(bundle,"hub","store.json"),JSON.stringify(hub));
 fs.writeFileSync(path.join(bundle,"tiquet","uploads","rg9a-note.txt"),
  "SYNTHETIC_OFFLINE_NOTE_DO_NOT_EMAIL\n");
 run("pg_dump",["-d",dbname,"-Fc","--no-owner","--no-acl",
  "-f",path.join(bundle,"tiquet","database.dump")]);
 const records=[
  ["hub/store.json",sum(path.join(bundle,"hub","store.json"))],
  ["tiquet/uploads/rg9a-note.txt",sum(path.join(bundle,"tiquet","uploads","rg9a-note.txt"))],
  ["tiquet/database.dump",sum(path.join(bundle,"tiquet","database.dump"))]
 ];
 // Integrity manifest + pinned identities written only in scratch directory.
 const manifest={source:"synthetic",schema:"sanitized-recovery-v1",
  artifacts:Object.fromEntries(records),dataset:"two-organizations-one-ticket-one-invoice-stage-job"};
 fs.writeFileSync(path.join(bundle,"manifest.json"),JSON.stringify(manifest));
 // Restore into entirely separate temporary file roots and separate DB.
 fs.mkdirSync(path.join(recover,"hub"),{recursive:true});
 fs.mkdirSync(path.join(recover,"tiquet","uploads"),{recursive:true});
 for(const [name] of records){
  const dest=path.join(recover,name);
  fs.copyFileSync(path.join(bundle,name),dest);
  assert.equal(sum(dest),manifest.artifacts[name]);
 }
 run("dropdb",["--if-exists",restoreName]);
 run("createdb",[restoreName]);
 run("pg_restore",["--exit-on-error","--single-transaction",
  "--no-owner","--no-acl","-d",restoreName,
  path.join(recover,"tiquet","database.dump")]);
 restored=new pg.Client({connectionString:url+restoreName});await restored.connect();
 assert.equal(await checkRestored(recover,restored),true);
 // Links and finance are restored, not merely accounted for.
 const invoice=(await restored.query("SELECT j.status,j.amount,l.ticket_id "+
  "FROM jobs j JOIN support_ticket_links l ON l.job_id=j.id AND l.account_id=j.account_id "+
  "WHERE j.id='releasegate_job'")).rows[0];
 assert.equal(invoice.status,"invoiced");
 assert.equal(Number(invoice.amount),300);
 assert.equal(invoice.ticket_id,"releasegate_ticket");
 const fk=Number((await restored.query("SELECT count(*) AS n FROM pg_constraint WHERE contype='f'")).rows[0].n);
 assert.ok(fk>=10);
 const duration=Math.ceil(performance.now()-started);
 // Negative: lost Hub state in an isolated *restored* directory is detectable.
 const cloned=path.join(recover,"hub","store.json");
 fs.renameSync(cloned,cloned+".missing");
 assert.throws(()=>fs.readFileSync(cloned),"missing Hub state should fail");
 fs.renameSync(cloned+".missing",cloned);
 assert.equal(await checkRestored(recover,restored),true);
 // Negative: post-restore file corruption is detectable against capture manifest.
 fs.appendFileSync(path.join(recover,"tiquet","uploads","rg9a-note.txt"),"CORRUPTED\n");
 assert.notEqual(sum(path.join(recover,"tiquet","uploads","rg9a-note.txt")),
  manifest.artifacts["tiquet/uploads/rg9a-note.txt"]);
 fs.copyFileSync(path.join(bundle,"tiquet","uploads","rg9a-note.txt"),
  path.join(recover,"tiquet","uploads","rg9a-note.txt"));
 assert.equal(await checkRestored(recover,restored),true);
 console.log("V79_RELEASE_GATES_SANITIZED_PAIR_RESTORE=PASS");
 console.log("V79_RELEASE_GATES_RESTORED_ACCOUNT_JOB_TICKET_LINK=PASS");
 console.log("V79_RELEASE_GATES_MISSING_STORE_AND_TAMPER_NEGATIVE_TESTS=PASS");
 console.log("V79_RELEASE_GATES_SYNTHETIC_RESTORE_ELAPSED_MS="+duration);
 console.log("V79_RELEASE_GATES_REAL_WORLD_RTO_RPO=NOT_ESTABLISHED");
 console.log("V79_RELEASE_GATES_MULTI_STORE_ATOMICITY=NOT_ESTABLISHED");
 console.log("V79_RELEASE_GATES_PRODUCTION_ACCESS=NONE");
}finally{
 await close(restored);await close(db);
 try{run("dropdb",["--if-exists",restoreName]);}catch{}
 fs.rmSync(temp,{recursive:true,force:true});
}
