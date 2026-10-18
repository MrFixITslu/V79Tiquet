"use strict";
// Fresh GitHub CI PostgreSQL only. Copies public code to an owned scratch tree;
// production-mode HTTP handlers never touch the checkout's uploads/data/logs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const DB='postgresql://tiquet_test:tiquet_test_password@127.0.0.1:5432/tiquet_test';
const SECRET='ci_jwt_secret_0123456789abcdef0123456789abcdef';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.NODE_ENV!=='test'||
   process.env.DATABASE_URL!==DB||process.env.JWT_SECRET!==SECRET||
   process.env.CI_TENANT_FILE_DELTA!=='1')throw Error('REFUSING_NON_DISPOSABLE_FILE_DELTA');
const jwt=require('jsonwebtoken');
const pg=require('pg');
const ROOT=path.resolve(__dirname,'..');
const pool=new pg.Pool({connectionString:DB,connectionTimeoutMillis:3000,query_timeout:5000});
const ids=[0,1].map(()=>({account:randomUUID(),user:randomUUID(),org:randomUUID(),job:randomUUID(),file:randomUUID()}));
const failures=[];let run,child;let databaseOwned=false;let phase='FRESH_DATABASE';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const general=id=>path.join(run,'uploads','general',id.file);
const jobFile=id=>path.join(run,'uploads',id.account,'Synthetic',id.job,'fixture.txt');
const bodyFor=id=>'synthetic-private-file-'+id.account;
const jobUrl=id=>'/api/files/'+id.account+'/Synthetic/'+id.job+'/fixture.txt';
const token=id=>jwt.sign({id:id.user,account_id:id.account,hub_managed:true,
  hub_organization_id:id.org},SECRET,{expiresIn:'10m',jwtid:randomUUID()});
async function api(route,auth,method='GET'){
  return fetch('http://127.0.0.1:3000'+route,{method,redirect:'manual',
    signal:AbortSignal.timeout(5000),headers:auth?{authorization:'Bearer '+auth}:{}});
}
async function check(name,action){
  try{await action();console.log(name+'=PASS');}
  catch{failures.push(name);console.error(name+'=FAIL_REDACTED');}
}
async function stop(){
  if(!child||child.exitCode!==null)return;
  const current=child;let timer;
  const exited=new Promise(resolve=>current.once('exit',resolve));
  current.kill('SIGTERM');
  try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('STOP_TIMEOUT')),5000)})]);}
  finally{clearTimeout(timer);if(current.exitCode===null){current.kill('SIGKILL');await exited;}}
}
async function boot(){
  // No inherited credentials/provider URLs or dotenv file in the copied tree.
  child=spawn(process.execPath,['server/index.js'],{cwd:run,stdio:'ignore',env:{
    PATH:process.env.PATH,NODE_ENV:'production',DATABASE_URL:DB,JWT_SECRET:SECRET,
    SUPER_ADMIN_JWT_SECRET:'synthetic_file_admin_secret_0123456789abcdef',
    V79_ALLOW_LEGACY_AUTH:'0',V79_HUB_MANAGED_BILLING:'1',
    V79_ENTITLEMENT_RECHECK_ENABLED:'0',SEED_DEMO_DATA:'false',PORT:'3050'}});
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw Error('API_EXITED');
    try{const r=await api('/health');if(r.ok)return;}catch{}
    await sleep(250);
  }
  throw Error('HEALTH_TIMEOUT');
}
(async()=>{
  try{
    const tables=await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
    assert.equal(tables.rows[0].n,0,'requires fresh dedicated CI service, no reuse');databaseOwned=true;
    phase='COPY_PUBLIC_SOURCE';
    run=fs.mkdtempSync(path.join(ROOT,'.ci-file-delta-'));fs.chmodSync(run,0o700);
    fs.mkdirSync(path.join(run,'server'));fs.mkdirSync(path.join(run,'scripts'));
    for(const entry of fs.readdirSync(path.join(ROOT,'server'),{withFileTypes:true})){
      if(!/\.(js|sql)$/.test(entry.name))continue;
      assert.ok(entry.isFile()&&!entry.isSymbolicLink());
      fs.copyFileSync(path.join(ROOT,'server',entry.name),path.join(run,'server',entry.name));
    }
    fs.copyFileSync(path.join(ROOT,'scripts','migrate-sqlite-to-pg.js'),path.join(run,'scripts','migrate-sqlite-to-pg.js'));
    fs.writeFileSync(path.join(run,'package.json'),JSON.stringify({type:'module'}));
    fs.mkdirSync(path.join(run,'dist'));fs.writeFileSync(path.join(run,'dist','index.html'),'<html>SYNTHETIC_SPA_SHELL</html>');
    phase='BOOT_PRODUCTION_MODE';await boot();
    phase='SEED_SYNTHETIC';const now=new Date().toISOString();
    for(const id of ids){
      await pool.query("INSERT INTO accounts(id,name,createdat,status,hub_organization_id) VALUES($1,'Synthetic',$2,'active',$3)",[id.account,now,id.org]);
      await pool.query("INSERT INTO users(id,name,email,role,account_id,hub_user_id) VALUES($1,'Synthetic',$2,'Admin',$3,$4)",[id.user,id.user+'@example.test',id.account,'scoped-'+id.org]);
      await pool.query("INSERT INTO jobs(id,title,client,status,createdat,priority,account_id) VALUES($1,'Synthetic','Synthetic','New',$2,'Normal',$3)",[id.job,now,id.account]);
      await pool.query("INSERT INTO files(id,name,size,type,uploadedat,uploadedby,account_id) VALUES($1,'fixture.txt',$2,'text/plain',$3,'synthetic@example.test',$4)",[id.file,Buffer.byteLength(bodyFor(id)),now,id.account]);
      fs.mkdirSync(path.dirname(general(id)),{recursive:true});fs.writeFileSync(general(id),bodyFor(id));
      fs.mkdirSync(path.dirname(jobFile(id)),{recursive:true});fs.writeFileSync(jobFile(id),bodyFor(id));
    }
    const [a,b]=ids.map(token);phase='FILE_BOUNDARIES';
    await check('OWN_GENERAL_FILE_DOWNLOAD',async()=>{
      for(const [id,auth] of [[ids[0],a],[ids[1],b]]){
        const r=await api('/api/files/'+id.file+'/download',auth);assert.equal(r.status,200);assert.equal(await r.text(),bodyFor(id));
      }
    });
    await check('TENANT_GENERAL_LIST_AND_READ_DELETE_DENIAL',async()=>{
      const listing=await api('/api/files',a);assert.equal(listing.status,200);
      assert.deepEqual((await listing.json()).map(x=>x.id),[ids[0].file]);
      assert.ok([403,404].includes((await api('/api/files/'+ids[1].file+'/download',a)).status));
      assert.equal((await api('/api/files/'+ids[1].file,a,'DELETE')).status,404);
      const row=await pool.query('SELECT account_id FROM files WHERE id=$1',[ids[1].file]);
      assert.equal(row.rows[0].account_id,ids[1].account);assert.equal(fs.readFileSync(general(ids[1]),'utf8'),bodyFor(ids[1]));
    });
    await check('OWN_JOB_FILE_LIST_AND_DOWNLOAD',async()=>{
      const listing=await api('/api/jobs/'+ids[0].job+'/files',a);assert.equal(listing.status,200);
      assert.equal((await listing.json()).files.length,1);
      const r=await api(jobUrl(ids[0]),a);assert.equal(r.status,200);assert.equal(await r.text(),bodyFor(ids[0]));
    });
    await check('TENANT_JOB_FILE_LIST_READ_DELETE_DENIAL',async()=>{
      assert.equal((await api('/api/jobs/'+ids[1].job+'/files',a)).status,404);
      assert.equal((await api(jobUrl(ids[1]),a)).status,403);
      assert.equal((await api('/api/jobs/'+ids[1].job+'/files/fixture.txt',a,'DELETE')).status,404);
      assert.equal(fs.readFileSync(jobFile(ids[1]),'utf8'),bodyFor(ids[1]));
      const r=await api(jobUrl(ids[1]),b);assert.equal(r.status,200);assert.equal(await r.text(),bodyFor(ids[1]));
    });
    await check('ANONYMOUS_FILE_ROUTES_DENIED',async()=>{
      for(const route of ['/api/files','/api/files/'+ids[1].file+'/download',jobUrl(ids[1]),'/api/jobs/'+ids[1].job+'/files'])assert.equal((await api(route)).status,401);
      assert.equal((await api('/api/files/'+ids[1].file,undefined,'DELETE')).status,401);
    });
    await check('PRODUCTION_STATIC_UPLOAD_CONTENT_NOT_EXPOSED',async()=>{
      for(const route of ['/uploads/general/'+ids[1].file,'/uploads/'+ids[1].account+'/Synthetic/'+ids[1].job+'/fixture.txt']){
        const r=await api(route);assert.equal(r.status,200);
        // The production SPA fallback is 200; prove it is the shell, not file bytes.
        assert.match(r.headers.get('content-type')||'',/text\/html/);
        assert.equal(await r.text(),'<html>SYNTHETIC_SPA_SHELL</html>');
      }
    });
    assert.equal(failures.length,0,'all focused boundaries must pass');
    console.log('SCOPE=PRODUCTION_MODE_SOURCE_SYNTHETIC_FILES_NOT_INSTALLED_IMAGE_OR_HUB_ENTITLEMENT');
  }finally{
    const errors=[];
    const actions=[()=>stop(),
      ()=>databaseOwned&&pool.query('DELETE FROM files WHERE account_id=ANY($1::text[])',[ids.map(x=>x.account)]),
      ()=>databaseOwned&&pool.query('DELETE FROM jobs WHERE account_id=ANY($1::text[])',[ids.map(x=>x.account)]),
      ()=>databaseOwned&&pool.query('DELETE FROM users WHERE account_id=ANY($1::text[])',[ids.map(x=>x.account)]),
      ()=>databaseOwned&&pool.query('DELETE FROM accounts WHERE id=ANY($1::text[])',[ids.map(x=>x.account)]),
      ()=>pool.end(),()=>{if(run){assert.equal(path.dirname(run),ROOT);assert.match(path.basename(run),/^\.ci-file-delta-[A-Za-z0-9]+$/);fs.rmSync(run,{recursive:true,force:false});}}];
    for(const action of actions){try{await action()}catch{errors.push(true)}}
    assert.equal(errors.length,0,'owned disposable teardown complete');
  }
})().catch(()=>{console.error('TENANT_FILE_DELTA=FAIL_REDACTED');console.error('FAIL_STAGE='+phase);process.exitCode=1});
