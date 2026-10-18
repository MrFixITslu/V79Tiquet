"use strict";
// CI-only full API/WS handler + durable revocation across API restart.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const jwt=require('jsonwebtoken');
const pg=require('pg');
const WebSocket=require('ws');
const DB='postgresql://tiquet_test:tiquet_test_password@127.0.0.1:5432/tiquet_test';
const SECRET='ci_jwt_secret_0123456789abcdef0123456789abcdef';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.NODE_ENV!=='test'||
   process.env.DATABASE_URL!==DB||process.env.JWT_SECRET!==SECRET||
   process.env.V79_ALLOW_LEGACY_AUTH!=='0'||process.env.CI_FULL_HANDLER_DELTA!=='1')
  throw Error('REFUSING_NON_DISPOSABLE_SESSION_DELTA');
const pool=new pg.Pool({connectionString:DB,connectionTimeoutMillis:3000});
const ids=[0,1].map(()=>({account:randomUUID(),user:randomUUID(),org:randomUUID(),job:randomUUID(),portal:randomUUID()}));
const sockets=[];let child;let phase='BOOT';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(path,token,method='GET',cookie=false,body){
  return fetch('http://127.0.0.1:3000'+path,{method,redirect:'manual',signal:AbortSignal.timeout(5000),
    ...(body?{body:JSON.stringify(body)}:{}),
    headers:{...(cookie?{cookie:'tiquet_session='+encodeURIComponent(token)}:{authorization:'Bearer '+token}),...(body?{'content-type':'application/json'}:{})}});
}
async function boot(){
  child=spawn(process.execPath,['server/index.js'],{stdio:'ignore',env:{...process.env,
    SEED_DEMO_DATA:'false',V79_ENTITLEMENT_RECHECK_ENABLED:'0',PORT:'3050'}});
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw Error('API_EXITED');
    try{const res=await fetch('http://127.0.0.1:3000/health',{signal:AbortSignal.timeout(1000)});
      if(res.ok)return;}catch{}
    await sleep(250);
  }
  throw Error('API_HEALTH_TIMEOUT');
}
async function stop(){
  if(!child||child.exitCode!==null)return;
  const current=child;
  const exited=new Promise(resolve=>current.once('exit',resolve));
  current.kill('SIGTERM');
  let timeout;
  try{await Promise.race([exited,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('API_STOP_TIMEOUT')),5000)})]);}
  finally{clearTimeout(timeout);if(current.exitCode===null)current.kill('SIGKILL');}
}
function issue(id){return jwt.sign({id:id.user,account_id:id.account,hub_managed:true,hub_organization_id:id.org},SECRET,{expiresIn:'30m',jwtid:randomUUID()});}
async function connect(query){
  const socket=new WebSocket('ws://127.0.0.1:3000/ws?'+new URLSearchParams(query));
  sockets.push(socket);socket.on('error',()=>{});socket.received=[];
  socket.on('message',data=>{try{socket.received.push(JSON.parse(data))}catch{}});
  socket.closed=new Promise(resolve=>socket.once('close',code=>resolve(code)));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WS_OPEN_TIMEOUT')),5000);
    socket.once('open',()=>{clearTimeout(timer);resolve()});socket.once('error',()=>{clearTimeout(timer);reject(Error('WS_OPEN_FAILED'))});});
  // Allow the actual async authorization handler to bind the subscription.
  await sleep(500);assert.equal(socket.readyState,WebSocket.OPEN,'authorized socket stays open');
  return socket;
}
async function broadcast(id,token,expected,excluded=[]){
  const marker='synthetic-delta-'+randomUUID();
  assert.equal((await api('/api/jobs/'+id.job+'/messages',token,'POST',false,{sender:'Synthetic',content:marker})).status,201);
  const until=Date.now()+5000;
  while(!expected.every(socket=>socket.received.some(x=>x.message?.content===marker))){
    assert.ok(Date.now()<until,'authorized subscription receives own broadcast');await sleep(25);
  }
  await sleep(150);
  for(const socket of excluded)assert.ok(!socket.received.some(x=>x.message?.content===marker),'other tenant/closed socket receives no message');
}
async function closed(socket,expected){
  let timer;
  try{const code=await Promise.race([socket.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WS_REVOKE_TIMEOUT')),22000)})]);
    assert.equal(code,expected,'actual full-handler revocation code');}
  finally{clearTimeout(timer);}
}
(async()=>{
  try{
    await boot();phase='SEED';const now=new Date().toISOString();
    for(const id of ids){
      await pool.query("INSERT INTO accounts(id,name,createdat,status,hub_organization_id) VALUES($1,'Synthetic delta',$2,'active',$3)",[id.account,now,id.org]);
      await pool.query("INSERT INTO users(id,name,email,role,account_id,hub_user_id) VALUES($1,'Synthetic delta',$2,'Admin',$3,$4)",[id.user,id.user+'@example.test',id.account,'scoped-'+id.org]);
      await pool.query("INSERT INTO jobs(id,title,client,status,createdat,priority,account_id,securetoken,securetokenexpires) VALUES($1,'Synthetic job','Synthetic','New',$2,'Normal',$3,$4,$5)",[id.job,now,id.account,id.portal,new Date(Date.now()+600000).toISOString()]);
    }
    phase='INITIAL_AUTH';const [a,b]=ids.map(issue);
    assert.equal((await api('/api/auth/me',a)).status,200);
    assert.equal((await api('/api/auth/me',b)).status,200);
    phase='OPEN_SOCKETS';const staffA=await connect({jobId:ids[0].job,auth:a});
    const staffB=await connect({jobId:ids[1].job,auth:b});
    const portalA=await connect({token:ids[0].portal});
    const portalB=await connect({token:ids[1].portal});
    phase='ESTABLISHED_SCOPED_SUBSCRIPTIONS';
    await broadcast(ids[0],a,[staffA,portalA],[staffB,portalB]);
    await broadcast(ids[1],b,[staffB,portalB],[staffA,portalA]);
    phase='STAFF_LOGOUT';assert.equal((await api('/api/auth/logout',a,'POST',true)).status,200);
    await closed(staffA,4003);
    assert.equal(staffB.readyState,WebSocket.OPEN,'independent staff B unaffected');
    for(const cookie of [false,true])assert.equal((await api('/api/auth/me',a,'GET',cookie)).status,401);
    await broadcast(ids[1],b,[staffB,portalB],[staffA,portalA]);
    await broadcast(ids[0],issue(ids[0]),[portalA],[staffA,staffB,portalB]);
    console.log('FULL_HANDLER_STAFF_LOGOUT_SOCKET_REVOCATION=PASS');
    phase='PORTAL_ROTATE';await pool.query('UPDATE jobs SET securetoken=$1 WHERE id=$2',[randomUUID(),ids[0].job]);
    await closed(portalA,4003);
    assert.equal(portalB.readyState,WebSocket.OPEN,'independent portal B unaffected');
    assert.equal(staffB.readyState,WebSocket.OPEN,'staff B persists across portal revoke');
    await broadcast(ids[1],b,[staffB,portalB],[staffA,portalA]);
    assert.equal((await api('/api/portal/'+ids[0].portal,b)).status,404);
    console.log('FULL_HANDLER_PORTAL_ROTATION_SOCKET_REVOCATION=PASS');
    phase='RESTART';await stop();await boot();phase='REPLAY_AFTER_RESTART';
    for(const cookie of [false,true]){
      const denied=await api('/api/auth/me',a,'GET',cookie);assert.equal(denied.status,401);
      assert.equal((await denied.json()).code,'SESSION_REVOKED');
    }
    assert.equal((await api('/api/auth/me',b)).status,200);
    assert.equal((await api('/api/auth/me',issue(ids[0]))).status,200);
    console.log('COPIED_JWT_DENIED_AFTER_API_RESTART_OTHER_TENANT_VALID=PASS');
    console.log('SCOPE=DISPOSABLE_CURRENT_SOURCE_NOT_INSTALLED_IMAGE_OR_HUB_ENTITLEMENT');
  }finally{
    for(const socket of sockets)socket.terminate();
    await stop();
    await pool.query('DELETE FROM job_messages WHERE account_id=ANY($1::text[])',[ids.map(x=>x.account)]);
    await pool.query('DELETE FROM revoked_auth_tokens WHERE account_id=ANY($1::text[])',[ids.map(x=>x.account)]);
    await pool.query('DELETE FROM jobs WHERE id=ANY($1::text[])',[ids.map(x=>x.job)]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::text[])',[ids.map(x=>x.user)]);
    await pool.query('DELETE FROM accounts WHERE id=ANY($1::text[])',[ids.map(x=>x.account)]);
    await pool.end();
  }
})().catch(()=>{console.error('FULL_HANDLER_SESSION_DELTA=FAIL_REDACTED');console.error('FAIL_STAGE='+phase);process.exitCode=1});
