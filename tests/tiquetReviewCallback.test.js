import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeCallbackSecret,parsePlanningCallback,applyTiquetReviewCallback,ReviewCallbackError
} from '../server/tiquetReviewCallback.js';

const P='123e4567-e89b-42d3-a456-426614174000';
const input=()=>({eventId:'tiquet-review-'+P,organizationId:'org-caribbean-1234',
  jobId:'job-123',projectId:P});

function mockDb({status='in-progress',wrongOrg=false,notApproved=false,stale=false,
  invalidLogs=false}={}){
  let state=status,updates=0,logs=0,commits=0,rollbacks=0,after=0,txActive=false;
  return {
    db:{transaction:cb=>async()=>{
      txActive=true;
      const tx={query:async(sql,params=[])=>{
        if(sql.includes('FROM tiquet_planning_outbox')){
          if(wrongOrg)return {rows:[]};
          return {rows:[{
            id:'job-123',status:state,quoteApproved:notApproved?0:1,
            account_id:'account-1',title:'ICT rollout',
            timeLogs:invalidLogs?'{bad':'[]',timerStartedAt:null,
            assignedTo:'Technician',stageAssignments:'{}'
          }]};
        }
        if(sql.includes('UPDATE jobs SET status=')){
          if(stale)return {rows:[]};
          assert.match(sql,/status='in-progress' RETURNING id/);
          assert.equal(params[4],'job-123');state=params[0];updates++;
          return {rows:[{id:'job-123'}]};
        }
        if(sql.includes('INSERT INTO activity_logs')){
          assert.equal(params[1],'job-123');logs++;return {rows:[]};
        }
        throw Error('Unexpected SQL '+sql);
      }};
      try{const result=await cb(tx);commits++;txActive=false;return result}
      catch(e){rollbacks++;txActive=false;throw e}
    }},
    get:()=>({status:state,updates,logs,commits,rollbacks,txActive,after}),
    afterCommit:async()=>{assert.equal(txActive,false);after++;}
  };
}
test('Service callback uses separate 32-character constant-time secret',()=>{
  assert.equal(safeCallbackSecret('a'.repeat(40),'a'.repeat(40)),true);
  assert.equal(safeCallbackSecret('b'.repeat(40),'a'.repeat(40)),false);
  assert.equal(safeCallbackSecret('short','short'),false);
  assert.equal(safeCallbackSecret(undefined,'a'.repeat(40)),false);
});
test('Callback identity has exact project-bound event ID',()=>{
  assert.deepEqual(parsePlanningCallback(input()),{
    organizationId:'org-caribbean-1234',jobId:'job-123',projectId:P});
  for(const patch of [{eventId:'different'}, {organizationId:'../path'},
    {jobId:'../../etc'}, {projectId:'not-a-uuid'}])
    assert.throws(()=>parsePlanningCallback({...input(),...patch}),ReviewCallbackError);
});
test('Review stage and activity commit atomically and emit one postcommit event',async()=>{
  const x=mockDb();const event=parsePlanningCallback(input());
  const a=await applyTiquetReviewCallback({db:x.db,event,afterCommit:x.afterCommit});
  const b=await applyTiquetReviewCallback({db:x.db,event,afterCommit:x.afterCommit});
  assert.equal(a.duplicate,false);assert.equal(b.duplicate,true);
  assert.deepEqual(x.get(),{
    status:'review',updates:1,logs:1,commits:2,rollbacks:0,txActive:false,after:1});
});
test('Tenant mismatch or quote not approved fails without a stage update',async()=>{
  for(const o of [{wrongOrg:true},{notApproved:true}]){
    const x=mockDb(o);
    await assert.rejects(()=>applyTiquetReviewCallback({db:x.db,event:parsePlanningCallback(input())}),
      e=>e.status===404);
    assert.equal(x.get().updates,0);
  }
});
test('Reject stale stage, invalid data or conditional update race',async()=>{
  for(const o of [{status:'request'},{invalidLogs:true},{stale:true}]){
    const x=mockDb(o);
    await assert.rejects(()=>applyTiquetReviewCallback({db:x.db,event:parsePlanningCallback(input())}),
      e=>e.status===409);
    assert.equal(x.get().logs,0);
    assert.equal(x.get().rollbacks,1);
  }
});
test('Already invoiced or paid never reverts to Review',async()=>{
  for(const status of ['review','invoiced','completed','paid']){
    const x=mockDb({status});
    const r=await applyTiquetReviewCallback({db:x.db,event:parsePlanningCallback(input())});
    assert.equal(r.duplicate,true);assert.equal(x.get().updates,0);
  }
});
