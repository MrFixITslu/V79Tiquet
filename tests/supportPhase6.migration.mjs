import assert from "node:assert/strict";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const u=new URL(process.env.DATABASE_URL||"postgres://invalid/invalid");
if(process.env.NODE_ENV!=="test"||process.env.CI_SUPPORT_SYNTHETIC!=="1"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0"||u.hostname!=="127.0.0.1"||
 u.pathname!=="/tiquet_support_test")
 throw new Error("PHASE6_MIGRATION_DISPOSABLE_GUARD");
const target="tiquet_support_migration_test";
const sourceDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../server/support");
const phases=["schema.sql","mail-schema.sql","phase4-schema.sql","phase6-hub-schema.sql"];
const admin=new pg.Client({connectionString:u.toString()});
let clone;
try{
 await admin.connect();
 // Exactly named local scratch database; never modifies source DB.
 await admin.query('DROP DATABASE IF EXISTS "'+target+'" WITH (FORCE)');
 await admin.query('CREATE DATABASE "'+target+'"');
 u.pathname="/"+target;
 clone=new pg.Client({connectionString:u.toString()});await clone.connect();
 await clone.query("CREATE TABLE accounts(id TEXT PRIMARY KEY)");
 await clone.query("CREATE TABLE users(id TEXT PRIMARY KEY, account_id TEXT,role TEXT,permissions TEXT)");
 await clone.query("CREATE TABLE clients(id TEXT PRIMARY KEY, account_id TEXT)");
 await clone.query("CREATE TABLE jobs(id TEXT PRIMARY KEY, account_id TEXT,status TEXT,amount INTEGER)");
 await clone.query("INSERT INTO accounts VALUES('legacyA'),('legacyB')");
 await clone.query("INSERT INTO users VALUES('legacyOwner','legacyA','Admin','[]')");
 await clone.query("INSERT INTO clients VALUES('legacyClient','legacyA')");
 await clone.query("INSERT INTO jobs VALUES('legacyJob','legacyA','paid',500)");
 for(const file of phases)await clone.query(await fs.readFile(path.join(sourceDir,file),"utf8"));
 for(const file of phases)await clone.query(await fs.readFile(path.join(sourceDir,file),"utf8"));
 const names=(await clone.query("SELECT table_name FROM information_schema.tables "+
  "WHERE table_schema='public' AND table_name LIKE 'support_%' ORDER BY table_name")).rows.map(r=>r.table_name);
 assert.ok(names.length>=17, "expected 17 or more support-only tables: "+names.length);
 await clone.query("INSERT INTO support_hub_context VALUES('legacyA','org-legacyA','active')");
 await clone.query("INSERT INTO support_hub_memberships VALUES"+
  "('legacyA','legacyOwner','org-legacyA','user-legacyOwner','owner')");
 await clone.query("INSERT INTO support_tickets(id,account_id,subject,created_by) "+
  "VALUES('synthetic-ticket','legacyA','Synthetic migrated ticket','legacyOwner')");
 await clone.query("INSERT INTO support_ticket_links(account_id,ticket_id,job_id,created_by) "+
  "VALUES('legacyA','synthetic-ticket','legacyJob','legacyOwner')");
 assert.equal((await clone.query("SELECT count(*)::int AS n FROM support_ticket_links")).rows[0].n,1);
 // A production rollback requires fresh approval: this executable path is
 // hard-gated by exact local DB + separate scratch name above.
 const rollback=await fs.readFile(path.join(sourceDir,"phase6-synthetic-rollback.sql"),"utf8");
 assert.equal(/\bCASCADE\b/i.test(rollback.replace(/^--.*$/gm,"")),false);
 assert.equal(/\b(?:accounts|users|clients|jobs)\b\s*;/i.test(rollback),false);
 await clone.query(rollback);
 const left=(await clone.query("SELECT table_name FROM information_schema.tables "+
  "WHERE table_schema='public' AND table_name LIKE 'support_%'")).rows;
 assert.equal(left.length,0,"rollback must remove support-only tables");
 for(const [table,count] of [["accounts",2],["users",1],["clients",1],["jobs",1]]){
  assert.equal((await clone.query("SELECT count(*)::int AS n FROM "+table)).rows[0].n,count);
 }
 const job=(await clone.query("SELECT status,amount FROM jobs WHERE id='legacyJob'")).rows[0];
 assert.deepEqual(job,{status:"paid",amount:500});
 // Forward recreation after rollback is also tested.
 for(const file of phases)await clone.query(await fs.readFile(path.join(sourceDir,file),"utf8"));
 const count=(await clone.query("SELECT count(*)::int AS n FROM support_tickets")).rows[0].n;
 assert.equal(count,0);
 await clone.query(rollback);
 console.log("SUPPORT_P6_DISPOSABLE_MIGRATION_REAPPLY_ROLLBACK=PASS");
 console.log("SUPPORT_P6_LEGACY_ROWS_AND_FINANCE_JOB_PRESERVED=PASS");
}finally{
 try{await clone?.end();}catch{}
 try{
  if(admin._connected) await admin.query('DROP DATABASE IF EXISTS "'+target+'" WITH (FORCE)');
 }finally{await admin.end().catch(()=>{});}
}
