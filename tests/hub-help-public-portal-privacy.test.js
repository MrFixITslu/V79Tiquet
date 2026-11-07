// Regression: customer Help bearer links must not reveal internal Tiquet job records.
// This test uses only a synthetic job and does not call production services.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
const marker=source.indexOf('// Hub App Help tickets carry an internal staff description');
const quoteStart=source.indexOf('app.post("/api/portal/:token/approve-quote"');
assert.ok(marker>=0&&quoteStart>marker,'source patch must remain present');
const job={
 id:'job-synthetic',title:'[App Help] HUB — Error report',
 client:'Example Customer',status:'request',priority:'high',
 createdAt:'2026-11-07T18:00:00Z',
 description:'Reference: PRIVATE-REF\n\nRequester: Private <private@example.invalid>\n\nHub organisation: internal-org\n\nCustomer-reviewed synthetic issue.',
 clientEmail:'private@example.invalid',account_id:'internal-account',
 secureToken:'sensitive-bearer',intakeEventId:'hub-help:'+'a'.repeat(64)
};
const rows=[
 {id:'customer',sender:'Client',content:'A safe update.',timestamp:job.createdAt},
 {id:'staff',sender:'Private Staff',content:'internal staff details',timestamp:job.createdAt}
];
function response(){
 let status=200,headers={};
 return {setHeader:(key,value)=>{headers[key]=value;},
 status(next){status=next;return this;},
 json(body){return {status,headers,body};}};
}
function fixtureContext(){
 let active=job, getHandler;
 const sandbox={
  isProduction:false,
  app:{get:(_path,handler)=>{getHandler=handler;}},
  getActivePortalJob:async()=>active,
  getJobMessages:async()=>rows
 };
 vm.runInNewContext(source.slice(marker,quoteStart),sandbox);
 return {handler:()=>getHandler,setActive:value=>{active=value;}};
}

test('Hub support portal shows only reviewed fields, no staff details or tenant identifiers',async()=>{
 const x=fixtureContext();
 const out=await x.handler()({params:{token:'synthetic'}},response());
 assert.equal(out.status,200);
 assert.equal(out.body.job.description,'Customer-reviewed synthetic issue.');
 assert.equal(out.body.job.messages.length,1);
 assert.equal(out.body.job.messages[0].sender,'Client');
 assert.equal(out.body.billing.available,false);
 assert.equal(out.headers['Cache-Control'],'no-store');
 assert.equal(out.headers['Referrer-Policy'],'no-referrer');
 const publicText=JSON.stringify(out.body);
 for(const restricted of ['internal-org','internal-account','private@example.invalid','sensitive-bearer','internal staff details','PRIVATE-REF']){
  assert.ok(!publicText.includes(restricted),restricted);
 }
 assert.equal(out.body.job.activityLog.length,0);
});

test('unrecognised or expired portal link remains unavailable',async()=>{
 const x=fixtureContext();x.setActive(null);
 const out=await x.handler()({params:{token:'not-valid'}},response());
 assert.equal(out.status,404);
 assert.equal(out.body.error,'Invalid or expired link');
});

test('Hub support tickets cannot approve quotes or enter billing actions',async()=>{
 const deny='Billing and quote actions are unavailable for support tickets.';
 assert.equal(source.split(deny).length-1,3);
 const start=source.indexOf('async function startPortalWipayCheckout(',quoteStart);
 assert.ok(start>quoteStart);
 let approve;
 const base={
  isProduction:false,
  isHubHelpPortalJob:value=>String(value?.intakeEventId||'').startsWith('hub-help:'),
  getActivePortalJob:async()=>job,
  portalActionLimiter:()=>{},
  db:{prepare:()=>{throw Error('billing must not be reached');}}
 };
 vm.runInNewContext(source.slice(quoteStart,start),{
  ...base,app:{post:(_route,_limit,handler)=>{approve=handler;}}
 });
 let out=await approve({params:{token:'synthetic'}},response());
 assert.equal(out.status,403);
 const payRoute=source.indexOf('app.post("/api/portal/:token/pay-deposit"',start);
 const payCtx={...base};
 vm.runInNewContext(source.slice(start,payRoute),payCtx);
 out=await payCtx.startPortalWipayCheckout({params:{token:'synthetic'}},response(),'deposit');
 assert.equal(out.status,403);
 let confirm;
 const confirmStart=source.indexOf('app.post("/api/portal/:token/payment-confirm"',payRoute);
 const confirmEnd=source.indexOf('app.get("/api/billing/return/:token"',confirmStart);
 assert.ok(confirmStart>0&&confirmEnd>confirmStart);
 vm.runInNewContext(source.slice(confirmStart,confirmEnd),{
  ...base,app:{post:(_route,_limit,handler)=>{confirm=handler;}}
 });
 out=await confirm({params:{token:'synthetic'},body:{orderId:'v79_synthetic'}},response());
 assert.equal(out.status,403);
});
