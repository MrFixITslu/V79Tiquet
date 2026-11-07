import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {hubHelpConfig,validateHubHelp,createHubHelpRouter} from '../server/hubHelpSupport.js';
test('support machine integration defaults off and requires explicit complete destination/owner mapping',()=>{
 assert.equal(hubHelpConfig({}).enabled,false);
 const env={V79_HELP_SUPPORT_ENABLED:'1',V79_HELP_SUPPORT_SHARED_SECRET:'s'.repeat(64),V79_HELP_SUPPORT_ACCOUNT_ID:'account',V79_HELP_SUPPORT_ORGANIZATION_ID:'org',V79_HELP_SUPPORT_OWNER_USER_ID:'owner',V79_HELP_SUPPORT_OWNER_HUB_USER_ID:'hub-owner'};
 assert.equal(hubHelpConfig(env).enabled,true);
 for(const key of Object.keys(env))assert.equal(hubHelpConfig({...env,[key]:''}).enabled,false,key);
 assert.equal(hubHelpConfig({...env,V79_HELP_SUPPORT_SHARED_SECRET:'short'}).enabled,false);
 assert.equal(hubHelpConfig({...env,V79_HELP_SUPPORT_ACCOUNT_ID:'foreign path/evil'}).enabled,false);
});
test('support schema rejects destination/priority/contact shape overrides and private control characters',()=>{
 const event={schemaVersion:1,requestId:'a'.repeat(64),app:'hub',kind:'error',summary:'Synthetic customer reviewed problem.',requester:{organizationId:'org',userId:'user',name:'Synthetic',email:'test@example.invalid',workspace:'Synthetic workspace'}};
 assert.equal(validateHubHelp(event),event);
 for(const extra of ['accountId','priority','assignedTo','url','destination'])assert.throws(()=>validateHubHelp({...event,[extra]:'forged'}),e=>e.status===400);
 for(const patch of [{summary:'short'},{summary:'bad\u0000'.repeat(20)},{requestId:'abc'},{schemaVersion:2},{kind:'urgent'},{app:'admin'},{requester:{...event.requester,email:'invalid'}},{requester:{...event.requester,role:'owner'}}])assert.throws(()=>validateHubHelp({...event,...patch}),e=>e.status===400);
});
test('default-off support ingress is unavailable and does not touch the database',async t=>{
 const db={transaction(){throw Error('No database calls allowed');}},app=express();app.use('/support',createHubHelpRouter({db,config:hubHelpConfig({})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/support`,{method:'POST'});assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
});
