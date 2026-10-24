import test from "node:test";
import assert from "node:assert/strict";
import {createServer as createViteServer} from "vite";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import path from "node:path";
const server=await createViteServer({configFile:path.resolve("tests/support-ui/vite.config.ts"),
 appType:"custom",server:{middlewareMode:true},logLevel:"error"});
try{
 const mod=await server.ssrLoadModule(path.resolve("src/support/SupportDeskSandbox.tsx"));
 const api=await server.ssrLoadModule(path.resolve("src/support/sandboxApi.ts"));
 test("isolated UX renders scoped navigation and explicit simulated state",()=>{
  const html=renderToStaticMarkup(React.createElement(mod.SupportDeskSandbox,{
   api:{list:async()=>({items:[],nextCursor:null})}
  }));
  for(const text of ["ENGINEERING SANDBOX","Support Inbox","Customer Context",
   "Linked Service Jobs","Support Reports","Mailbox &amp; Settings","Nothing sent",
   "New ticket","Conversations"]){
   assert.ok(html.includes(text),text+" missing");
  }
  assert.ok(!html.includes("Public reply sent"));
  assert.ok(!html.includes("https://hub.v79sl.com"));
 });
 test("mail delivery notices differentiate accepted, failed and uncertain",()=>{
  assert.match(mod.deliveryLabel("accepted"),/not inbox-confirmed/i);
  assert.match(mod.deliveryLabel("uncertain"),/do not resend/i);
  assert.match(mod.deliveryLabel("failed"),/failed/i);
  assert.match(mod.deliveryLabel("queued"),/not sent/i);
 });
 test("locality gate rejects production domains, HTTPS or external previews",()=>{
  assert.doesNotThrow(()=>api.assertLocalSyntheticUrl({hostname:"127.0.0.1",protocol:"http:"}));
  assert.throws(()=>api.assertLocalSyntheticUrl({hostname:"tiquet.v79sl.com",protocol:"https:"}));
  assert.throws(()=>api.assertLocalSyntheticUrl({hostname:"localhost",protocol:"https:"}));
  assert.throws(()=>api.assertLocalSyntheticUrl({hostname:"example.com",protocol:"http:"}));
 });
 test("synthetic API adapter uses paginated GET, idempotency and If-Match",async()=>{
  const calls=[];
  const mockFetch=async(url,init)=>{
   calls.push({url,init});
   const body=url.includes("/tickets?")?{items:[],nextCursor:null}:
     url.endsWith("/messages")?{id:"note-id",visibility:"internal"}:
     {id:"synthetic",version:2,subject:"Synthetic ticket"};
   return new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json",ETag:'"2"'}});
  };
  const client=api.createSandboxApi("","agentA","demoA",mockFetch);
  await client.list({status:"open",search:"network"});
  await client.create("Synthetic outage","high");
  await client.patch("ticketA",1,{status:"resolved"});
  await client.note("ticketA","Synthetic internal note");
  assert.equal(calls.length,4);
  assert.match(calls[0].url,/limit=25/);
  assert.match(calls[0].url,/status=open/);
  assert.match(calls[0].url,/search=network/);
  assert.equal(calls[1].init.method,"POST");
  assert.match(calls[1].init.headers["Idempotency-Key"],/^synthetic_/);
  assert.equal(calls[2].init.headers["If-Match"],'"1"');
  assert.equal(JSON.parse(calls[3].init.body).visibility,"internal");
  for(const call of calls){
   assert.equal(call.init.headers["x-synthetic-user"],"agentA");
   assert.equal(call.init.headers["x-synthetic-account"],"demoA");
   assert.equal(call.init.credentials,"same-origin");
  }
 });
 test("API errors are explicit and never appear as success",async()=>{
  const reject=async()=>new Response(JSON.stringify({code:"STALE_TICKET",error:"Changed remotely"}),{
   status:412,headers:{"Content-Type":"application/json"}});
  await assert.rejects(api.createSandboxApi("","agentA","demoA",reject).patch("ticketA",1,{status:"open"}),
   e=>e.status===412&&e.code==="STALE_TICKET");
 });
}finally{
 await server.close();
}
