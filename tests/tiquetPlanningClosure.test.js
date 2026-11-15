import test from 'node:test';
import assert from 'node:assert/strict';
import {
  queueTiquetPlanningClosure,sendTiquetPlanningClosure,sweepTiquetPlanningClosure
} from '../server/tiquetPlanningClosure.js';

test('Only approved FFPRO linked jobs are queued on invoicing with idempotency',async()=>{
  const queries=[];
  const tx={query:async(sql,params)=>{queries.push({sql,params});return {rows:[]}}};
  const a=await queueTiquetPlanningClosure(tx,{accountId:'acct-1',jobId:'job-123',
    invoicedAt:'2026-11-14T15:00:00.000Z'});
  const b=await queueTiquetPlanningClosure(tx,{accountId:'acct-1',jobId:'job-123',
    invoicedAt:'2026-11-14T15:01:00.000Z'});
  assert.equal(a,b);assert.match(a,/^tiquet-close-[a-f0-9]{48}$/);
  assert.match(queries[0].sql,/status='sent' AND project_id IS NOT NULL/);
  assert.match(queries[0].sql,/ON CONFLICT\(account_id,job_id\) DO NOTHING/);
});
const row={accountId:'acct-1',jobId:'job-123',
  eventId:'tiquet-close-1234',projectId:'123e4567-e89b-42d3-a456-426614174000'};
test('Service closure endpoint uses authenticated org/job/project pairing',async()=>{
  const seen=[];
  const db={query:async()=>({rows:[{organizationId:'org-caribbean-1234',status:'invoiced'}]})};
  const r=await sendTiquetPlanningClosure({db,row,baseUrl:'https://ffpro.example.test',
    secret:'x'.repeat(40),fetchImpl:async(url,opts)=>{
      seen.push({url,opts});return {ok:true,status:200}
    }});
  assert.equal(r.kind,'sent');
  assert.equal(seen[0].url,'https://ffpro.example.test/api/gateway/webhooks/tiquet/planning/closed');
  assert.deepEqual(JSON.parse(seen[0].opts.body),{
    organizationId:'org-caribbean-1234',jobId:'job-123',projectId:row.projectId});
});
test('Never closes FFPRO project from ticket in the wrong stage',async()=>{
  const db={query:async()=>({rows:[{organizationId:'org-caribbean-1234',status:'review'}]})};
  let calls=0;
  const r=await sendTiquetPlanningClosure({db,row,baseUrl:'https://ffpro.example.test',
    secret:'x'.repeat(40),fetchImpl:async()=>{calls++}});
  assert.equal(r.kind,'retry');assert.equal(calls,0);
});
test('Credential failures are terminal; review-not-ready retries',async()=>{
  const db={query:async()=>({rows:[{organizationId:'org-caribbean-1234',status:'invoiced'}]})};
  for(const [status,kind] of [[401,'permanent'],[403,'permanent'],
    [409,'retry'],[404,'retry'],[503,'retry']]){
    const r=await sendTiquetPlanningClosure({db,row,baseUrl:'https://ffpro.example.test',
      secret:'x'.repeat(40),fetchImpl:async()=>({ok:false,status})});
    assert.equal(r.kind,kind);
  }
});
test('No queue scans or external calls before credentials are configured',async()=>{
  let called=0;
  const db={query:async()=>{called++}};
  const r=await sweepTiquetPlanningClosure({db,baseUrl:'',secret:''});
  assert.deepEqual(r,{disabled:true,processed:0});assert.equal(called,0);
});
