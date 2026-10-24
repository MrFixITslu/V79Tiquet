// Disposable, complete SYNTHETIC stores: PostgreSQL + fake Hub JSON +
// fake upload files. Never inspect actual Hub runtime, mounts, host data, keys.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import pg from "pg";
const dsn="postgresql://support_test:support_test_password@127.0.0.1:5432/tiquet_support_test";
if(process.env.GITHUB_ACTIONS!=="true"||process.env.CI_SUPPORT_SYNTHETIC!=="1"||
 process.env.NODE_ENV!=="test"||process.env.V79_SUPPORT_DESK_ENABLED!=="0"||
 process.env.V79_ALLOW_PRODUCTION_DEPLOY!=="0"||process.env.DATABASE_URL!==dsn)
 throw Error("PHASE9_RECOVERY_REFUSED_NONDISPOSABLE");
const restoreDB="tiquet_support_phase9_restore_test",temp=fs.mkdtempSync(path.join(os.tmpdir(),"tiquet-phase9-restore-"));
const dburl=name=>"postgresql://support_test:support_test_password@127.0.0.1:5432/"+name;
const cmd=(tool,args)=>execFileSync(tool,args,{encoding:"utf8",timeout:90000,env:{
 ...process.env,PGPASSWORD:"support_test_password",PGHOST:"127.0.0.1",PGPORT:"5432",PGUSER:"support_test"
}});
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const source=new pg.Client({connectionString:dsn});
let clone;
const manifest={},fixtures=["hub-store.json","uploads/synthetic-note.txt"];
const tableCounts=async client=>{
 const names=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' "+
  "AND (tablename LIKE 'support_%' OR tablename IN ('accounts','users','clients','jobs')) "+
  "ORDER BY tablename")).rows.map(r=>r.tablename);
 const values={};
 for(const name of names){
  if(!/^(support_[a-z_]+|accounts|users|clients|jobs)$/.test(name))throw Error("UNEXPECTED_TABLE_NAME");
  values[name]=Number((await client.query('SELECT count(*) AS n FROM "'+name+'"')).rows[0].n);
 }
 return values;
};
try{
 fs.mkdirSync(path.join(temp,"uploads"));
 fs.writeFileSync(path.join(temp,"hub-store.json"),
  JSON.stringify({source:"synthetic",orgs:[{id:"p9-demo-org",status:"active"}],
   sessions:[{idHash:"0".repeat(64),status:"revoked"}]},null,2));
 fs.writeFileSync(path.join(temp,"uploads/synthetic-note.txt"),
  "SYNTHETIC_NOTE_NO_PERSONAL_DATA\n");
 for(const item of fixtures)manifest[item]=sha(path.join(temp,item));
 await source.connect();
 const original=await tableCounts(source);
 assert.ok(Object.keys(original).filter(x=>x.startsWith("support_")).length>=17,
  "support schema fixture required before full recovery");
 // Entire disposable DB is backed up, not just a subset of support tables.
 cmd("dropdb",["--if-exists",restoreDB]);
 cmd("pg_dump",["--format=custom","--no-owner","--no-acl","-d","tiquet_support_test",
  "-f",path.join(temp,"db.dump")]);
 assert.ok(fs.statSync(path.join(temp,"db.dump")).size>2000);
 manifest["db.dump"]=sha(path.join(temp,"db.dump"));
 cmd("createdb",[restoreDB]);
 cmd("pg_restore",["--no-owner","--no-acl","--single-transaction","--exit-on-error",
  "-d",restoreDB,path.join(temp,"db.dump")]);
 clone=new pg.Client({connectionString:dburl(restoreDB)});await clone.connect();
 const after=await tableCounts(clone);
 assert.deepEqual(after,original,"restored schema+all data counts");
 const fks=Number((await clone.query("SELECT count(*) AS n FROM pg_constraint WHERE contype='f' "+
  "AND connamespace='public'::regnamespace")).rows[0].n);
 assert.ok(fks>=10,"restored FK constraints");
 for(const [filename,digest] of Object.entries(manifest)){
  assert.equal(sha(path.join(temp,filename)),digest,"original manifest check");
 }
 const corruption=path.join(temp,"uploads/corrupt.txt");
 fs.copyFileSync(path.join(temp,"uploads/synthetic-note.txt"),corruption);
 fs.appendFileSync(corruption,"TAMPERED");
 assert.notEqual(sha(corruption),manifest["uploads/synthetic-note.txt"],
  "tamper detection must trigger");
 // Check restored customer and job data values, if tests created them.
 const originalData=await source.query("SELECT id,account_id FROM jobs ORDER BY id LIMIT 20");
 const restoredData=await clone.query("SELECT id,account_id FROM jobs ORDER BY id LIMIT 20");
 assert.deepEqual(restoredData.rows,originalData.rows);
 console.log("SUPPORT_P9_DISPOSABLE_COMPLETE_DB_HUBJSON_UPLOAD_RESTORE=PASS");
 console.log("SUPPORT_P9_TAMPER_DETECTION=PASS");
 console.log("SUPPORT_P9_CROSS_STORE_ATOMICITY=UNPROVEN_RELEASE_BLOCKER");
 console.log("SUPPORT_P9_OFFHOST_PRODUCTION_RESTORE=UNTESTED_RELEASE_BLOCKER");
}finally{
 try{await clone?.end();}catch{}
 try{await source.end();}catch{}
 try{cmd("dropdb",["--if-exists",restoreDB]);}catch{}
 fs.rmSync(temp,{recursive:true,force:true});
}
