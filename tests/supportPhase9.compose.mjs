// No live .env, production compose, engine connections or runtime inspection.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "node:child_process";
if(process.env.CI_SUPPORT_SYNTHETIC!=="1"||process.env.NODE_ENV!=="test"||
 process.env.V79_ALLOW_PRODUCTION_DEPLOY!=="0"||
 process.env.GITHUB_ACTIONS!=="true")throw Error("PHASE9_COMPOSE_DISPOSABLE_ONLY");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"v79-p9-compose-"));
const out=(on)=>new Promise((resolve,reject)=>{
 try{
  const flags=on?"1":"0";
  const sample=[
   "DB_PASSWORD=synthetic_disposable_only_12345",
   "DB_USER=tiquet_test","DB_NAME=tiquet_test",
   "V79_TIQUET_LAUNCH_SECRET=synthetic_p9_shared_secret_1234567890",
   "V79_ENTITLEMENT_RECHECK_ENABLED="+flags,
   "V79_TIQUET_SESSION_BINDING_ENABLED="+flags,
   "V79_ALLOW_LEGACY_AUTH=0",
   "V79_HUB_MANAGED_BILLING=1",
   "V79_HUB_INTERNAL_URL=http://v79-hub:3040"
  ].join("\n")+"\n";
  fs.writeFileSync(path.join(dir,".env"),sample,{mode:0o600});
  const raw=execFileSync("docker",["compose","--project-name","synthetic-p9",
   "--project-directory",dir,"--env-file",path.join(dir,".env"),
   "-f",path.join(dir,"docker-compose.yml"),"config","--format","json"],{
    cwd:dir,encoding:"utf8",timeout:30000,env:{...process.env,
     DB_PASSWORD:"synthetic_disposable_only_12345",
     V79_ENTITLEMENT_RECHECK_ENABLED:flags,
     V79_TIQUET_SESSION_BINDING_ENABLED:flags}
   });
  const composed=JSON.parse(raw);
  const app=composed.services["v79-tiquet-manager"],db=composed.services["tiquet-postgres"];
  assert.ok(app&&db);
  assert.equal(app.environment.V79_ENTITLEMENT_RECHECK_ENABLED,flags);
  assert.equal(app.environment.V79_TIQUET_SESSION_BINDING_ENABLED,flags);
  assert.equal(app.environment.V79_ALLOW_LEGACY_AUTH,"0");
  assert.equal(app.environment.NODE_ENV,"production");
  assert.equal(app.environment.V79_HUB_INTERNAL_URL,"http://v79-hub:3040");
  assert.ok(!("ports" in app)&&!("ports" in db),"no published ports");
  assert.ok(composed.networks.proxy_network.external);
  assert.ok(app.build&&app.build.target==="production");
  resolve();
 }catch(e){reject(e);}
});
try{
 fs.copyFileSync("docker-compose.yml",path.join(dir,"docker-compose.yml"));
 await out(false);
 await out(true);
 console.log("SUPPORT_P9_COMPOSE_RENDER_SYNTHETIC_FLAGS_OFF_AND_ON=PASS");
 console.log("SUPPORT_P9_NO_CONTAINERS_STARTED=YES");
}finally{fs.rmSync(dir,{force:true,recursive:true});}
