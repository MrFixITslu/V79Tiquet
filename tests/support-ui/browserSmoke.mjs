import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {WebSocket} from "ws";
if(process.env.CI_SUPPORT_SYNTHETIC!=="1"||process.env.NODE_ENV!=="test"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0")
 throw new Error("BROWSER_SYNTHETIC_TEST_ONLY");
const browser=["/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
 "/usr/bin/chromium","/usr/bin/chromium-browser"].find(x=>fs.existsSync(x));
if(!browser){
 console.log("SUPPORT_UI_BROWSER=SKIPPED_NO_LOCAL_CHROME");
 process.exit(0);
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"tiquet-synthetic-chrome-"));
const chrome=spawn(browser,["--headless=new","--no-sandbox","--disable-gpu",
 "--disable-dev-shm-usage","--no-first-run","--no-default-browser-check",
 "--remote-debugging-port=9335","--remote-allow-origins=*",
 "--user-data-dir="+dir,"about:blank"],{stdio:"ignore"});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function getTarget(){
 for(let attempt=0;attempt<80;attempt++){
  if(chrome.exitCode!==null)throw new Error("SYNTHETIC_CHROME_EXITED");
  try{
   const response=await fetch("http://127.0.0.1:9335/json");
   const items=await response.json();
   const tab=items.find(item=>item.type==="page"&&item.webSocketDebuggerUrl);
   if(tab)return tab.webSocketDebuggerUrl;
  }catch{}
  await pause(150);
 }
 throw new Error("CHROME_CDP_UNAVAILABLE");
}
let socket;
try{
 socket=new WebSocket(await getTarget(),{origin:"http://127.0.0.1:9335"});
 await new Promise((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);});
 let id=0;
 const pending=new Map(),errors=[];
 socket.on("message",raw=>{
  const message=JSON.parse(String(raw));
  if(message.method==="Runtime.exceptionThrown")
   errors.push(message.params.exceptionDetails.text||"Runtime exception");
  if(!message.id)return;
  const cb=pending.get(message.id);
  if(cb){pending.delete(message.id);cb(message);}
 });
 async function command(method,params={}){
  const requestId=++id;
  const response=new Promise((resolve,reject)=>{
   pending.set(requestId,msg=>{
    if(msg.error)reject(Error(method+": "+msg.error.message));
    else resolve(msg.result);
   });
   setTimeout(()=>{if(pending.has(requestId)){pending.delete(requestId);
    reject(Error("CDP timeout: "+method));}},10000).unref?.();
  });
  socket.send(JSON.stringify({id:requestId,method,params}));
  return response;
 }
 const evaluate=async expression=>{
  const r=await command("Runtime.evaluate",{expression,returnByValue:true,
   awaitPromise:true});
  if(r.exceptionDetails)throw Error("BROWSER_EVAL_ERROR: "+r.exceptionDetails.text);
  return r.result.value;
 };
 const until=async(expression,what)=>{
  for(let n=0;n<70;n++){
   if(await evaluate(expression))return;
   await pause(200);
  }
  const info=await evaluate("({href:location.href,title:document.title,body:document.body?.innerText?.slice(0,700),scripts:Array.from(document.scripts).map(x=>x.src),root:document.querySelector('#root')?.innerHTML?.slice(0,500)})");
  throw Error("BROWSER_ACCEPTANCE_TIMEOUT: "+what+" DEBUG="+JSON.stringify(info));
 };
 await command("Page.enable");
 await command("Runtime.enable");
 await command("Page.navigate",{url:"http://127.0.0.1:4308/"});
 await until("document.querySelectorAll('.sd-ticket').length>=3","synthetic tickets load");
 assert.equal(await evaluate("document.body.innerText.includes('ENGINEERING SANDBOX')"),true);
 await until("Array.from(document.querySelectorAll('.sd-ticket')).some(x=>x.textContent.includes('<img src=x'))","XSS fixture visible as text");
 assert.equal(await evaluate("document.querySelector('.sd-ticket-list img')===null"),true);
 assert.equal(await evaluate("window.__support_p5_xss===undefined"),true);

 assert.equal(await evaluate("document.querySelector('.sd-sandbox-alert').textContent.includes('Nothing sent')"),true);
 await until("document.querySelector('.sd-conversation h2')?.textContent.length>3","ticket detail");
 await until("document.querySelector('.sd-customer-column')?.textContent.includes('Business-hours SLA')",
  "SLA context");
 assert.equal(await evaluate("document.querySelector('.sd-customer-column').textContent.includes('Synthetic policy')"),true);
 // Navigate and restore without creating any customer-facing message.
 await evaluate("Array.from(document.querySelectorAll('.sd-nav')).find(x=>x.textContent.includes('Support Reports')).click()");
 await until("document.querySelector('.sd-single-panel h2')?.textContent.includes('Support activity')",
  "reports navigation");
 assert.equal(await evaluate("document.querySelector('.sd-single-panel').textContent.includes('loaded page only')"),true);
 await evaluate("Array.from(document.querySelectorAll('.sd-nav')).find(x=>x.textContent.includes('Mailbox')).click()");
 await until("document.querySelector('.sd-single-panel')?.textContent.includes('Mock provider only')",
  "mailbox navigation");
 await evaluate("Array.from(document.querySelectorAll('.sd-nav')).find(x=>x.textContent.includes('Support Inbox')).click()");
 await until("document.querySelectorAll('.sd-ticket').length>=3","inbox return");
 await evaluate("Array.from(document.querySelectorAll('.sd-queue')).find(x=>x.textContent==='Open').click()");
 await until("Array.from(document.querySelectorAll('.sd-queue')).some(x=>x.textContent==='Open'&&x.getAttribute('aria-pressed')==='true')",
  "open queue selection");
 // Mobile: drawer and ticket detail must be accessible without desktop controls.
 await command("Emulation.setDeviceMetricsOverride",{
  width:390,height:844,deviceScaleFactor:1,mobile:true
 });
 await pause(400);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.sd-mobile-menu')).display!=='none'"),true);
 await evaluate("document.querySelector('.sd-mobile-menu').click()");
 assert.equal(await evaluate("document.querySelector('.sd-sidebar').classList.contains('sd-sidebar-open')"),true);
 await evaluate("document.querySelector('.sd-mobile-menu').click()");
 await evaluate("document.querySelector('.sd-ticket').click()");
 await until("document.querySelector('.sd-inbox').classList.contains('sd-show-detail')",
  "mobile conversation navigation");
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.sd-mobile-back')).display!=='none'"),true);
 // Accessibility and keyboard acceptance; no real customer actions.
 assert.equal(await evaluate("!!document.querySelector('a[href=\"#support-main\"]')"),true);
 assert.equal(await evaluate("document.querySelector('main#support-main')?.getAttribute('tabindex')"),"-1");
 assert.equal(await evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth+2"),true);
 await evaluate("document.querySelector('.sd-titlebar .sd-button-primary').click()");
 await until("!!document.querySelector('[role=\"dialog\"][aria-modal=\"true\"]')","ticket creation modal");
 assert.equal(await evaluate("document.activeElement===document.querySelector('.sd-modal input')"),true);
 assert.equal(await evaluate("document.querySelector('.sd-modal input').labels.length>0"),true);
 assert.equal(await evaluate("document.querySelector('.sd-modal select').labels.length>0"),true);
 // React's focus trap should wrap from the first to the last enabled control.
 await evaluate("document.querySelector('.sd-modal-title button').focus()");
 await command("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9,modifiers:8});
 await command("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9,modifiers:8});
 assert.equal(await evaluate("document.activeElement===document.querySelector('.sd-modal select')"),true);
 await command("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
 await command("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
 await until("!document.querySelector('[role=\"dialog\"]')","modal Escape close");
 assert.equal(await evaluate("document.querySelector('.sd-titlebar .sd-button-primary')===document.activeElement"),true);
 assert.equal(await evaluate("document.querySelectorAll('[role=\"alert\"] .sd-error').length"),0);
 assert.deepEqual(errors,[]);
 console.log("SUPPORT_UI_BROWSER_ACCEPTANCE=PASS_DESKTOP_MOBILE_SLAS_NAVIGATION");
}finally{
 socket?.close();
 chrome.kill("SIGTERM");
 await pause(200);
 try{fs.rmSync(dir,{recursive:true,force:true});}catch{}
}
