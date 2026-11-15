import test from 'node:test';
import assert from 'node:assert/strict';
import {depositTerms,setReviewDepositPolicy,DepositPolicyError} from '../server/tiquetDepositPolicy.js';

test('Legacy jobs retain 30% without a migration surprise',()=>{
  assert.deepEqual(depositTerms({amount:1200}),
    {policy:'legacy',rate:0.3,amount:360,pending:false,waived:false});
});
test('Explicit 20% policy is rounded to currency minor units',()=>{
  const x=depositTerms({amount:1234.56,depositPolicy:'twenty_percent'});
  assert.equal(x.amount,246.91);assert.equal(x.rate,0.2);
});
test('Waive does not represent a payment',()=>{
  assert.deepEqual(depositTerms({amount:1234.56,depositPolicy:'waived'}),
    {policy:'waived',rate:0,amount:0,pending:false,waived:true});
});
test('Pending review cannot collect old 30% deposit',()=>{
  assert.equal(depositTerms({amount:1000,depositPolicy:'review_pending'}).pending,true);
});
test('Unknown policy fails closed',()=>{
  assert.throws(()=>depositTerms({amount:1000,depositPolicy:'half'}),/Unrecognised/);
});
function fake({stage='review',issued=false,paid=0,linked=true,existing='review_pending'}={}){
  let current=existing,updates=0,logs=0,rollbacks=0;
  const tx={query:async(sql,args=[])=>{
    if(sql.includes('SELECT id,status,depositPolicy'))
      return {rows:[{id:'job-1',status:stage,depositPolicy:current,invoiceIssuedAt:issued?'y':null,invoiceSentAt:null}]};
    if(sql.includes('SELECT project_id FROM tiquet_planning_outbox'))
      return {rows:linked?[{project_id:'project-1'}]:[]};
    if(sql.includes('SUM(amount)'))return {rows:[{paid}]};
    if(sql.includes('UPDATE jobs SET depositPolicy')){
      updates++;current=args[0];return {rows:[{id:'job-1'}]};
    }
    if(sql.includes('INSERT INTO activity_logs')){logs++;return {rows:[]};}
    throw Error('Unexpected SQL '+sql);
  }};
  return {
    db:{transaction:fn=>async()=>{try{return await fn(tx)}catch(e){rollbacks++;throw e}}},
    state:()=>({current,updates,logs,rollbacks})
  };
}
const args=(db,policy)=>({db,accountId:'acct-1',jobId:'job-1',policy,actor:'reviewer@example.test'});
test('Reviewer explicitly selects 20% once and an audit event is recorded',async()=>{
  const x=fake();
  const a=await setReviewDepositPolicy(args(x.db,'twenty_percent'));
  const b=await setReviewDepositPolicy(args(x.db,'twenty_percent'));
  assert.equal(a.unchanged,false);assert.equal(b.unchanged,true);
  assert.deepEqual(x.state(),{current:'twenty_percent',updates:1,logs:1,rollbacks:0});
});
test('Waiver recorded as selection, not money received',async()=>{
  const x=fake();const a=await setReviewDepositPolicy(args(x.db,'waived'));
  assert.equal(a.policy,'waived');assert.equal(x.state().logs,1);
});
test('Reject policy edits when invoiced, issued, paid, or without FFPRO link',async()=>{
  for(const opt of [{stage:'invoiced'},{issued:true},{paid:100},{linked:false}]){
    const x=fake(opt);
    await assert.rejects(()=>setReviewDepositPolicy(args(x.db,'waived')),DepositPolicyError);
    assert.equal(x.state().updates,0);
  }
});
test('Invalid policy and missing actor fail before SQL',async()=>{
  const x=fake();
  await assert.rejects(()=>setReviewDepositPolicy(args(x.db,'legacy')),e=>e.status===400);
  await assert.rejects(()=>setReviewDepositPolicy({...args(x.db,'waived'),actor:''}),e=>e.status===400);
  assert.equal(x.state().updates,0);
});
