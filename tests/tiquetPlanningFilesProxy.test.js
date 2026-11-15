import test from 'node:test';
import assert from 'node:assert/strict';
import {PlanningFileProxyError,resolvePlanningFileScope,proxyPlanningFiles} from '../server/tiquetPlanningFilesProxy.js';

const projectId='123e4567-e89b-42d3-a456-426614174000';
const fileId='123e4567-e89b-42d3-a456-426614174010';
const secret='synthetic-test-file-gateway-secret-abcdef';
const baseUrl='https://ffpro.qa.invalid';
const job={id:'job-123',account_id:'account-123',status:'review'};
let queryCount=0;
const linkedDb={query:async(sql,args)=>{
  queryCount++;
  assert.match(sql,/tiquet_planning_outbox/);
  assert.deepEqual(args,['account-123','job-123','sent']);
  return {rows:[{projectId,organizationId:'org-caribbean-1234'}]};
}};
const stream=bytes=>new ReadableStream({
  start(controller){controller.enqueue(new Uint8Array(Buffer.from(bytes)));controller.close();}
});
const response=(bytes,status=200,headers={})=>({
  ok:status>=200&&status<300,status,
  headers:new Headers(headers),
  body:stream(bytes)
});

test('Only verified Review-or-later linked ticket can obtain scope',async()=>{
  for(const status of ['request','in-progress','cancelled']){
    queryCount=0;
    await assert.rejects(()=>resolvePlanningFileScope(linkedDb,{...job,status}),
      e=>e.status===404);
    assert.equal(queryCount,0);
  }
  const scope=await resolvePlanningFileScope(linkedDb,job);
  assert.deepEqual(scope,{projectId,jobId:'job-123',organizationId:'org-caribbean-1234'});
});

test('A client never supplies project or organisation identity',async()=>{
  const calls=[];
  const value=await proxyPlanningFiles({
    db:linkedDb,job,secret,baseUrl,
    fetchImpl:async(url,opts)=>{
      calls.push({url,opts});
      return response(JSON.stringify({files:[{id:fileId,name:'approved.pdf',size:5,type:'application/pdf'}]}),
        200,{'content-type':'application/json'});
    }
  });
  assert.equal(value.kind,'list');assert.equal(value.files.length,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,baseUrl+'/api/gateway/webhooks/tiquet/planning/'+projectId+'/files');
  assert.equal(calls[0].opts.headers['X-Tiquet-Organization-Id'],'org-caribbean-1234');
  assert.equal(calls[0].opts.headers['X-Tiquet-Job-Id'],'job-123');
  assert.equal(calls[0].opts.headers['X-Tiquet-Planning-Secret'],secret);
  assert.equal(calls[0].opts.redirect,'error');
});

test('Only authenticated service may fetch approved document bytes',async()=>{
  const buffer=Buffer.from('%PDF-1.4 synthetic');
  const result=await proxyPlanningFiles({
    db:linkedDb,job,fileId,secret,baseUrl,
    fetchImpl:async()=>response(buffer,200,{
      'content-length':String(buffer.length),
      'content-disposition':'attachment; filename="approved.pdf"',
      'content-type':'application/octet-stream'
    })
  });
  assert.equal(result.kind,'file');
  assert.equal(result.fileName,'approved.pdf');
  assert.deepEqual(result.data,buffer);
});

test('No secrets, wrong project, or unsupported origin fail closed',async()=>{
  for(const opts of [
    {secret:''},{baseUrl:'http://ffpro.qa.invalid'},
    {baseUrl:'https://user:password@ffpro.qa.invalid'},
    {baseUrl:'https://ffpro.qa.invalid/untrusted'},
    {fileId:'../../secrets'}
  ]){
    await assert.rejects(()=>proxyPlanningFiles({
      db:linkedDb,job,secret,baseUrl,...opts,
      fetchImpl:async()=>{throw Error('must not fetch')}
    }),PlanningFileProxyError);
  }
});

test('No unapproved/forged file downloads',async()=>{
  await assert.rejects(()=>proxyPlanningFiles({
    db:linkedDb,job,fileId,secret,baseUrl,
    fetchImpl:async()=>response('not found',404)
  }),e=>e.status===404);
});

test('Reject malicious upstream lists and excessive responses',async()=>{
  const tests=[
    response(JSON.stringify({files:[{id:'bad',name:'secret',size:1}]})),
    response('not-json'),
    response(Buffer.alloc(65537,65)),
  ];
  for(const payload of tests)
    await assert.rejects(()=>proxyPlanningFiles({
      db:linkedDb,job,secret,baseUrl,fetchImpl:async()=>payload
    }),PlanningFileProxyError);
});

test('Protects against tenant mapping loss',async()=>{
  const db={query:async()=>({rows:[{projectId,organizationId:null}]})};
  await assert.rejects(()=>proxyPlanningFiles({
    db,job,secret,baseUrl,fetchImpl:async()=>{throw Error('must not fetch')}
  }),e=>e.status===404);
});
