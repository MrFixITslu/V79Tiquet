const express = require("express");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const app = express();
const port = 18169, debug = 19266;
const root = path.resolve(__dirname,"..");
const jobId = "f51ab246-1234-4a1d-bacd-111111111111";
const sampleJob = {
  id: jobId, status: "request", priority: "high",
  intakeEventId: "4a39196a-0e70-422a-9363-4e0000000001",
  websiteAckStatus: "failed",
  title: "Fix clinic Wi-Fi", client: "Sample Customer", clientEmail: "test@example.invalid",
  description: "Testing isolated ticket navigation", amount: 80,
  assignedTo: "", dueDate: "2026-10-01T12:00:00Z",
  createdAt: "2026-10-01T10:00:00Z", activityLog: []
};
const settings = { name: "Demo Workspace", email: "support@example.invalid", currency: "XCD",
  address: "", phone: "", paymentTerms: "", website: "", taxRate: 0, logoUrl: "" };
app.use(express.json());
app.get("/api/auth/me", (_req,res)=>res.json({id:"test-staff",name:"Test Operator",email:"test@example.invalid",role:"Admin",account_id:"isolated-test",permissions:["dashboard","jobs","invoices"]}));
app.get("/api/settings", (_req,res)=>res.json(settings));
app.get("/api/jobs", (_req,res)=>res.json([sampleJob]));
app.put("/api/jobs/:id/due-date", (req,res)=>{
  if(req.params.id!==jobId) return res.status(404).json({error:"Job not found"});
  sampleJob.dueDate=req.body.dueDate;
  res.json({success:true,job:sampleJob});
});
app.get("/api/payments/summary", (_req,res)=>res.json({received:0,count:0,outstandingInvoices:0}));
for(const ep of ["/api/clients","/api/employees","/api/payroll","/api/users","/api/industries","/api/files"]) {
  app.get(ep,(_req,res)=>res.json([]));
}
app.use(express.static(path.join(root,"dist"),{fallthrough:true}));
app.get("*",(_req,res)=>res.sendFile(path.join(root,"dist/index.html")));
const server=app.listen(port,"127.0.0.1");
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"v79-tiquet-headless-"));
const chrome=spawn("/usr/bin/google-chrome",[
 "--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
 "--no-first-run","--no-default-browser-check","--remote-allow-origins=*",
 "--window-size=1440,900","--user-data-dir="+profile,
 "--remote-debugging-port="+debug,
 "http://127.0.0.1:"+port+"/"
],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,tries=70,delay=170){
 let last; for(let i=0;i<tries;i++){try{const value=await fn();if(value)return value;}catch(e){last=e;}await sleep(delay);}
 throw new Error("Wait timed out: "+String(last||"unmet condition"));
}
const pending=new Map(); let sequence=1;
let socket;
function command(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=sequence++;
  pending.set(id,{resolve,reject});
  socket.send(JSON.stringify({id,method,params}));
  setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error("CDP timeout "+method));}},8000);
 });
}
async function evaluate(expression){
 const resp=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
 if(resp&&resp.exceptionDetails)throw new Error(resp.exceptionDetails.text);
 return resp.result&&resp.result.value;
}
async function main(){
 const targets=await poll(async()=>{
  const r=await fetch("http://127.0.0.1:"+debug+"/json");
  const j=await r.json();
  return j.find(x=>x.type==="page"&&x.webSocketDebuggerUrl);
 },80,150);
 socket=new WebSocket(targets.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
 socket.addEventListener("message",event=>{
   const message=JSON.parse(String(event.data));
   if(message.id&&pending.has(message.id)){
     const p=pending.get(message.id);pending.delete(message.id);
     message.error?p.reject(new Error(message.error.message)):p.resolve(message.result||{});
   }
 });
 await command("Runtime.enable"); await command("Page.enable");
 await poll(async()=>evaluate("Boolean(document.querySelector('[data-testid=tiquet-theme-toggle]')) && Boolean(document.querySelector('button[aria-label^=\"Open ticket:\"]'))"));
 const initial=await evaluate("({theme:document.querySelector('.v79-tiquet-app')?.dataset.theme,bg:getComputedStyle(document.querySelector('.v79-tiquet-app')).backgroundColor,buttons:document.querySelectorAll('button[aria-label^=\"Open ticket:\"]').length,text:document.body.innerText.includes('Fix clinic Wi-Fi'),disabled:document.querySelector('button[aria-label^=\"Open ticket:\"]')?.disabled})");
 assert.equal(initial.theme,"dark");assert.equal(initial.buttons,1);
 assert.equal(initial.text,true);assert.equal(initial.disabled,false);
 console.log("PASS: attention ticket is an enabled accessible button in dark mode",initial.bg);
 await evaluate("document.querySelector('[data-testid=tiquet-theme-toggle]').click();true");
 await poll(async()=>evaluate("document.querySelector('.v79-tiquet-app')?.dataset.theme==='light'"));
 const light=await evaluate("({theme:document.querySelector('.v79-tiquet-app').dataset.theme,shell:getComputedStyle(document.querySelector('.v79-tiquet-app')).backgroundColor,header:getComputedStyle(document.querySelector('main > header')).backgroundColor,preference:localStorage.getItem('v79-tiquet-theme'),aria:document.querySelector('[data-testid=tiquet-theme-toggle]').getAttribute('aria-label')})");
 assert.equal(light.theme,"light");assert.equal(light.preference,"light");
 assert.match(light.shell,/rgb\(244,\s*247,\s*251\)/);
 assert.equal(light.aria,"Switch to dark mode");
 console.log("PASS: light theme updates colours and persists",JSON.stringify(light));
 await evaluate("document.querySelector('button[aria-label^=\"Open ticket:\"]').click();true");
 await poll(async()=>evaluate("location.search.includes('tab=jobs') && location.search.includes('job=') && document.body.innerText.includes('Testing isolated ticket navigation')"));
 const clicked=await evaluate("({url:location.href,details:document.body.innerText.includes('Testing isolated ticket navigation')})");
 assert.match(clicked.url,/tab=jobs/);assert.match(clicked.url,/job=f51ab246/);assert.equal(clicked.details,true);
 console.log("PASS: attention ticket opens existing job detail and deep-link",clicked.url);
 await poll(async()=>evaluate("Boolean(document.querySelector('section[aria-label=\"Website enquiry and customer confirmation\"]'))"));
 const action=await evaluate("(()=>{const section=document.querySelector('section[aria-label=\"Website enquiry and customer confirmation\"]');const button=[...section.querySelectorAll('button')].find(b=>b.textContent.includes('Confirm & Convert to Customer'));return {exists:!!button,disabled:button?.disabled,ref:section.textContent.includes('TQ-F51AB2461234'),ack:section.textContent.includes('Retry required')}})()");
 assert.equal(action.exists,true);assert.equal(action.disabled,true);
 assert.equal(action.ref,true);assert.equal(action.ack,true);
 console.log("PASS: website ticket reference and admin-only conversion panel render with guarded action");

 await poll(async()=>evaluate("Boolean(document.querySelector('button[aria-label=\"Edit ticket due date\"]'))"));
 await evaluate("document.querySelector('button[aria-label=\"Edit ticket due date\"]').click();true");
 await poll(async()=>evaluate("Boolean(document.querySelector('input[aria-label=\"Ticket due date\"]'))"));
 await evaluate("document.querySelector('input[aria-label=\"Ticket due date\"]').parentElement.querySelectorAll('button')[1].click();true");
 await poll(async()=>evaluate("document.querySelector('input[aria-label=\"Ticket due date\"]').value===''"));
 await evaluate("document.querySelector('input[aria-label=\"Ticket due date\"]').parentElement.querySelector('button').click();true");
 await poll(async()=>evaluate("!document.querySelector('input[aria-label=\"Ticket due date\"]') && document.querySelector('button[aria-label=\"Edit ticket due date\"]')?.innerText.includes('Not set')"));
 assert.equal(sampleJob.dueDate,null);
 console.log("PASS: authorised ticket due-date editor clears and persists the ticket date");
 await command("Page.reload",{ignoreCache:true});
 await poll(async()=>evaluate("document.querySelector('.v79-tiquet-app')?.dataset.theme==='light' && document.body.innerText.includes('Testing isolated ticket navigation')"));
 const retained=await evaluate("({theme:document.querySelector('.v79-tiquet-app').dataset.theme,job:location.search.includes('job=')})");
 assert.equal(retained.theme,"light");assert.equal(retained.job,true);
 console.log("PASS: ticket and theme survive refresh");
 await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await sleep(600);
 const mobile=await evaluate("({visible:(()=>{const r=document.querySelector('[data-testid=tiquet-theme-toggle]').getBoundingClientRect();return r.width>=36&&r.left>=0&&r.right<=innerWidth})(),width:innerWidth})");
 assert.equal(mobile.visible,true);
 console.log("PASS: theme toggle accessible on mobile",mobile.width);
 console.log("BROWSER_E2E_PASS");
}
main().catch(e=>{console.error("BROWSER_E2E_FAILED",e.stack||e);process.exitCode=1}).finally(async()=>{
 try{socket?.close()}catch{}
 chrome.kill("SIGTERM");
 server.close();
 await sleep(150);
 try{fs.rmSync(profile,{recursive:true,force:true})}catch{}
});
