import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planningEventId,planningApprovalPayload,queueTiquetPlanningApproval,deliverPlanningApproval
} from '../server/tiquetPlanningOutbox.js';
import {sweepTiquetPlanning} from '../server/tiquetPlanningSweep.js';

test('Tiquet event ID is deterministic, unique per account and ticket',()=>{
  const a=planningEventId('acct-001','job-001');
  assert.match(a,/^tiquet-plan-[0-9a-f]{48}$/);
  assert.equal(a,planningEventId('acct-001','job-001'));
  assert.notEqual(a,planningEventId('acct-002','job-001'));
  assert.notEqual(a,planningEventId('acct-001','job-002'));
});

test('Approval outbox queues using transaction handle, never live CRM lead',async()=>{
  let q=[];
  const tx={query:async(sql,params)=>{q.push({sql,params});return {rows:[]}}};
  await queueTiquetPlanningApproval(tx,{jobId:'j1',accountId:'a1',approvedAt:'2026-11-14T10:00:00.000Z'});
  assert.equal(q.length,1);
  assert.match(q[0].sql,/ON CONFLICT\(account_id,job_id\) DO NOTHING/);
  assert.equal(q[0].params[0],'a1');
});

test('Planning payload always requires a Hub organisation and client-approved quote',()=>{
  const row={eventId:'tiquet-plan-12345678',approvedAt:'2026-11-14T10:00:00.000Z'};
  const job={id:'123',title:'ICT rollout',client:'Saint Lucia SME'};
  assert.throws(()=>planningApprovalPayload(row,job,''),/organisation/);
  const p=planningApprovalPayload(row,job,'org-001');
  assert.equal(p.approval,'client-quote-approved');
  assert.equal(p.customerName,'Saint Lucia SME');
  assert.equal(p.ticketNumber,job.id);
});

test('Unprovisioned organisation retries without making an external request',async()=>{
  let called=0;
  const db={query:async(sql)=>{
    if(sql.includes('FROM jobs'))return {rows:[{id:'j1',title:'ICT',client:'Client'}]};
    return {rows:[{hub_organization_id:null}]};
  }};
  const result=await deliverPlanningApproval({db,row:{accountId:'a1',jobId:'j1'},secret:'x'.repeat(40),
    baseUrl:'https://ffpro.example.test',fetchImpl:async()=>{called++;throw Error('must not send')}});
  assert.equal(result.kind,'retry');
  assert.equal(called,0);
});

test('Handoff sends only the configured service endpoint with separate secret',async()=>{
  let called;
  const db={query:async(sql)=>sql.includes('FROM jobs')
    ?{rows:[{id:'j1',title:'ICT',client:'SME'}]}
    :{rows:[{hub_organization_id:'org-verified'}]}};
  const result=await deliverPlanningApproval({db,
    row:{accountId:'a1',jobId:'j1',eventId:'tiquet-plan-123456789',approvedAt:new Date().toISOString()},
    secret:'x'.repeat(40),baseUrl:'https://ffpro.example.test',
    fetchImpl:async(url,options)=>{called={url,options};return {ok:true,status:201,json:async()=>({projectId:'p1'})}}});
  assert.equal(result.kind,'sent');assert.equal(result.projectId,'p1');
  assert.equal(called.url,'https://ffpro.example.test/api/gateway/webhooks/tiquet/planning/approved');
  assert.equal(called.options.headers['X-Tiquet-Planning-Secret'],'x'.repeat(40));
  assert.equal(JSON.parse(called.options.body).approval,'client-quote-approved');
});

test('Missing secret disables dispatch and does not invent successful delivery',async()=>{
  const result=await deliverPlanningApproval({db:null,baseUrl:'https://ffpro.example.test',secret:'x',row:{}});
  assert.equal(result.kind,'disabled');
});

test('Worker refuses to issue SQL when integration credentials are unset',async()=>{
  let calls=0;
  const result=await sweepTiquetPlanning({db:{query:()=>{calls++}},baseUrl:'',secret:''});
  assert.deepEqual(result,{disabled:true,processed:0});assert.equal(calls,0);
});
