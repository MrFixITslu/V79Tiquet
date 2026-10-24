import React,{useCallback,useEffect,useMemo,useState} from "react";
import type {SupportTicket,SupportMessage,TicketStatus,TicketPriority,SandboxApi,LinkedJob} from "./sandboxApi";
import {createSandboxApi,assertLocalSyntheticUrl,SupportApiError} from "./sandboxApi";
import "./supportDesk.css";

type Screen="inbox"|"customers"|"jobs"|"reports"|"mailbox";
type Filter="all"|"mine"|"new"|"open"|"waiting_customer"|"resolved";
const STATUSES:TicketStatus[]=["new","open","waiting_customer","resolved","closed"];
const PRIORITIES:TicketPriority[]=["low","normal","high","critical"];
const pretty=(value:string)=>value.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase());
const relative=(time:string)=>{const d=new Date(time);return Number.isFinite(d.valueOf())?d.toLocaleString():"—";};
export function deliveryLabel(state:SupportMessage["deliveryState"]){
 const names:Record<SupportMessage["deliveryState"],string>={
  not_applicable:"Received or internal",queued:"Queued · not sent",
  sending:"Attempting mock delivery",accepted:"Provider accepted · not inbox-confirmed",
  failed:"Mock delivery failed",uncertain:"Delivery uncertain · do not resend",
  cancelled:"Cancelled"
 };
 return names[state]||"Delivery unknown";
}
const asText=(e:unknown)=>e instanceof SupportApiError?(e.code+": "+e.message):
 e instanceof Error?e.message:"Action unavailable";
function Tag({children,tone="neutral"}:{children:React.ReactNode;tone?:string}){
 return <span className={"sd-tag sd-tag-"+tone}>{children}</span>;
}
function Empty({title,detail}:{title:string;detail:string}){
 return <div className="sd-empty"><h3>{title}</h3><p>{detail}</p></div>;
}
export function SupportDeskSandbox({api:provided}:{api?:SandboxApi}){
 const api=useMemo(()=>provided??createSandboxApi(),"");
 const [screen,setScreen]=useState<Screen>("inbox");
 const [filter,setFilter]=useState<Filter>("all");
 const [search,setSearch]=useState("");
 const [draftSearch,setDraftSearch]=useState("");
 const [tickets,setTickets]=useState<SupportTicket[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [selected,setSelected]=useState<SupportTicket|null>(null);
 const [messages,setMessages]=useState<SupportMessage[]>([]);
 const [links,setLinks]=useState<LinkedJob[]>([]);
 const [note,setNote]=useState("");
 const [jobId,setJobId]=useState("");
 const [createOpen,setCreateOpen]=useState(false);
 const [newSubject,setNewSubject]=useState("");
 const [newPriority,setNewPriority]=useState<TicketPriority>("normal");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(false);
 const [detailsLoading,setDetailsLoading]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [mobileDetail,setMobileDetail]=useState(false);
 const [sidebarOpen,setSidebarOpen]=useState(false);
 const load=useCallback(async(append=false,at:string|null=null)=>{
  setLoading(true);setError("");
  try{
   const page=await api.list({
    status:filter==="all"||filter==="mine"?undefined:filter,
    search:search||undefined,assigneeId:filter==="mine"?"agentA":undefined,
    cursor:append?at||undefined:undefined
   });
   setTickets(prev=>append?[...prev,...page.items]:page.items);
   setCursor(page.nextCursor);
   if(!append)setSelectedId(prev=>page.items.some(t=>t.id===prev)?prev:page.items[0]?.id??null);
  }catch(e){setError(asText(e));if(!append){setTickets([]);setCursor(null);setSelectedId(null);}}
  finally{setLoading(false);}
 },[api,filter,search]);
 useEffect(()=>{void load();},[load]);
 const loadDetails=useCallback(async(id:string)=>{
  setDetailsLoading(true);setError("");
  try{
   const [record,comments,relations]=await Promise.all([api.get(id),api.messages(id),api.links(id)]);
   setSelected(record.data);
   setMessages(comments.items);
   setLinks(relations.items);
  }catch(e){setSelected(null);setMessages([]);setLinks([]);setError(asText(e));}
  finally{setDetailsLoading(false);}
 },[api]);
 useEffect(()=>{
  setSelected(null);setMessages([]);setLinks([]);
  if(selectedId)void loadDetails(selectedId);
 },[selectedId,loadDetails]);
 const refresh=async()=>{await load();if(selectedId)await loadDetails(selectedId);};
 const mutate=async(fields:Partial<Pick<SupportTicket,"status"|"priority"|"subject">>)=>{
  if(!selected)return;setBusy(true);setError("");setNotice("");
  try{
   const updated=await api.patch(selected.id,selected.version,fields);
   setSelected(updated);await load();setNotice("Ticket updated in the synthetic database.");
  }catch(e){
   setError(asText(e));
   if(e instanceof SupportApiError&&e.status===412)await loadDetails(selected.id);
  }finally{setBusy(false);}
 };
 const addNote=async(e:React.FormEvent)=>{
  e.preventDefault();if(!selected||!note.trim())return;
  setBusy(true);setError("");setNotice("");
  try{
   await api.note(selected.id,note.trim());
   setNote("");await loadDetails(selected.id);
   setNotice("Private note saved in the synthetic database. Not emailed.");
  }catch(e){setError(asText(e));}finally{setBusy(false);}
 };
 const link=async(e:React.FormEvent)=>{
  e.preventDefault();if(!selected||!jobId.trim())return;
  setBusy(true);setError("");setNotice("");
  try{
   await api.linkJob(selected.id,jobId.trim());setJobId("");
   await loadDetails(selected.id);setNotice("Existing synthetic job linked without altering its status.");
  }catch(e){setError(asText(e));}finally{setBusy(false);}
 };
 const create=async(e:React.FormEvent)=>{
  e.preventDefault();if(newSubject.trim().length<3)return;
  setBusy(true);setError("");setNotice("");
  try{
   const ticket=await api.create(newSubject.trim(),newPriority);
   setCreateOpen(false);setNewSubject("");setNewPriority("normal");
   setFilter("all");setSearch("");setDraftSearch("");
   await load();setSelectedId(ticket.id);setMobileDetail(true);
   setScreen("inbox");setNotice("Synthetic ticket created. No customer notification sent.");
  }catch(e){setError(asText(e));}finally{setBusy(false);}
 };
 const open=(id:string)=>{setSelectedId(id);setMobileDetail(true);setScreen("inbox");};
 const agents=useMemo(()=>tickets.filter(t=>t.assignedTo==="agentA").length,[tickets]);
 const activeCount=tickets.filter(t=>!["resolved","closed"].includes(t.status)).length;
 const unavailable=tickets.filter(t=>t.status==="new"&&!t.assignedTo).length;
 const sender=messages.find(m=>m.actorId.startsWith("mail:"))?.actorId.slice(5);
 const nav:[Screen,string,string][]=[
  ["inbox","▤","Support Inbox"],["customers","♙","Customer Context"],
  ["jobs","▣","Linked Service Jobs"],["reports","◫","Support Reports"],
  ["mailbox","⚙","Mailbox & Settings"]
 ];
 return <div className="sd-app">
  <aside className={"sd-sidebar "+(sidebarOpen?"sd-sidebar-open":"")}>
   <header className="sd-brand"><span className="sd-brandmark">T</span><div><strong>TIQUET</strong><small>BY VISION79</small></div></header>
   <div className="sd-side-label">WORKSPACE</div>
   <nav aria-label="Support Desk navigation" className="sd-navigation">
    {nav.map(([key,symbol,label])=><button key={key} type="button" className={"sd-nav "+(screen===key?"sd-nav-active":"")} aria-current={screen===key?"page":undefined}
     onClick={()=>{setScreen(key);setSidebarOpen(false);setMobileDetail(false);}}>
     <span aria-hidden="true">{symbol}</span>{label}</button>)}
   </nav>
   <div className="sd-sidefoot"><div className="sd-sidebox"><strong>Vision79 Synthetic Workspace</strong>
    <span>Isolated engineering sandbox</span><span className="sd-lamp">● Offline · mock provider</span></div>
    <p>No real users, inboxes or production data.</p></div>
  </aside>
  <main className="sd-main">
   <header className="sd-topbar">
    <div className="sd-topstart">
     <button type="button" className="sd-mobile-menu" onClick={()=>setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation">☰</button>
     <span>Vision79 Synthetic Workspace</span><span className="sd-crumb">/ {nav.find(n=>n[0]===screen)?.[2]}</span>
    </div>
    <span className="sd-user">AG</span>
   </header>
   <div role="status" className="sd-sandbox-alert"><strong>ENGINEERING SANDBOX</strong> · Disposable synthetic tickets · Mock email only · Nothing sent · Not connected to production</div>
   <div className="sd-workspace">
    <div className="sd-titlebar">
     <div><div className="sd-kicker">CUSTOMER SUPPORT</div>
      <h1>{nav.find(n=>n[0]===screen)?.[2]}</h1>
      <p>{screen==="inbox"?"One workspace for customer conversations, assignment and action.":"Synthetic-only workflow validation; no production connections."}</p></div>
     <div className="sd-actions"><button type="button" className="sd-button sd-button-secondary" onClick={()=>void refresh()} disabled={loading||busy}>↻ Refresh</button>
      <button type="button" className="sd-button sd-button-primary" onClick={()=>setCreateOpen(true)}>+ New ticket</button></div>
    </div>
    {error&&<div role="alert" className="sd-feedback sd-error"><span>{error}</span><button onClick={()=>setError("")} aria-label="Dismiss error">×</button></div>}
    {notice&&<div role="status" className="sd-feedback sd-notice"><span>{notice}</span><button onClick={()=>setNotice("")} aria-label="Dismiss notice">×</button></div>}
    {screen==="inbox"&&<>
     <div className="sd-queues" role="group" aria-label="Ticket queues">
      {([["all","All"],["mine","Mine"],["new","New"],["open","Open"],
       ["waiting_customer","Waiting"],["resolved","Resolved"]] as [Filter,string][]).map(([key,label])=>
       <button type="button" key={key} className={"sd-queue "+(filter===key?"sd-queue-active":"")}
        aria-pressed={filter===key} onClick={()=>{setFilter(key);setMobileDetail(false);}}>{label}</button>)}
      <span className="sd-results-note">Showing {tickets.length} tickets{cursor?"+":""} · paged results</span>
     </div>
     <div className="sd-searchrow"><form onSubmit={e=>{e.preventDefault();setSearch(draftSearch);setMobileDetail(false);}}>
      <label htmlFor="supportSearch" className="sd-visually-hidden">Search support tickets by subject</label>
      <input id="supportSearch" placeholder="Search ticket subject..." value={draftSearch}
       onChange={e=>setDraftSearch(e.target.value)} maxLength={160}/>
      <button type="submit" className="sd-button sd-button-secondary">Search</button></form>
     </div>
     <div className={"sd-inbox "+(mobileDetail?"sd-show-detail":"")}>
      <section className="sd-ticket-column" aria-label="Support conversations">
       <div className="sd-panel-heading"><strong>Conversations</strong><span>{loading?"Loading...":tickets.length+" loaded"}</span></div>
       {tickets.length===0&&!loading?<Empty title="No tickets in this queue" detail="Try a different filter or create a synthetic ticket."/>:null}
       <div className="sd-ticket-list">
        {tickets.map(t=><button type="button" key={t.id} className={"sd-ticket "+(selectedId===t.id?"sd-ticket-active":"")} aria-pressed={selectedId===t.id}
         onClick={()=>open(t.id)}>
         <span className="sd-avatar">{t.subject.slice(0,2).toUpperCase()}</span>
         <span className="sd-ticket-text"><span className="sd-ticket-first"><strong>{t.subject}</strong><small>{relative(t.updatedAt)}</small></span>
          <span className="sd-ticket-desc">{t.clientId?"Customer ID: "+t.clientId:"No linked customer record"}</span>
          <span className="sd-ticket-tags"><Tag tone={t.priority==="critical"?"danger":t.priority==="high"?"warning":"neutral"}>{pretty(t.priority)}</Tag>
           <Tag tone={t.status==="open"?"success":t.status==="waiting_customer"?"warning":"neutral"}>{pretty(t.status)}</Tag></span></span></button>)}
       </div>
       {cursor&&<button type="button" className="sd-load" onClick={()=>void load(true,cursor)} disabled={loading}>Load next 25 tickets</button>}
      </section>
      <section className="sd-conversation" aria-label="Selected support conversation">
       <button className="sd-mobile-back" type="button" onClick={()=>setMobileDetail(false)}>← Back to inbox</button>
       {!selected?<Empty title={detailsLoading?"Loading conversation...":"Select a conversation"} detail="Choose a ticket from the inbox to view its details."/>:<>
        <header className="sd-conversation-head">
         <span className="sd-kicker">TICKET · {selected.id.slice(0,10)}</span>
         <h2>{selected.subject}</h2>
         <div className="sd-fields">
          <label>Status<select aria-label="Ticket status" disabled={busy} value={selected.status}
           onChange={e=>void mutate({status:e.target.value as TicketStatus})}>
           {STATUSES.map(s=><option key={s} value={s}>{pretty(s)}</option>)}</select></label>
          <label>Priority<select aria-label="Ticket priority" disabled={busy} value={selected.priority}
           onChange={e=>void mutate({priority:e.target.value as TicketPriority})}>
           {PRIORITIES.map(p=><option key={p} value={p}>{pretty(p)}</option>)}</select></label>
          <span className="sd-assignee">Assigned: {selected.assignedTo||"Unassigned"}</span>
         </div>
        </header>
        <div className="sd-thread">
         {messages.length===0?<Empty title="No messages yet" detail="Add an internal note to begin the support history."/>:null}
         {messages.length===25&&<p className="sd-thread-note">Showing the newest 25 messages. Older-message pagination is not implemented.</p>}
         {[...messages].reverse().map(m=><article key={m.id} className={"sd-message "+(m.visibility==="internal"?"sd-message-private":"")}>
          <header><strong>{m.actorId.startsWith("mail:")?"Synthetic customer":m.actorId}</strong>
           <time dateTime={m.createdAt}>{relative(m.createdAt)}</time>
           <Tag tone={m.visibility==="internal"?"warning":"neutral"}>{m.visibility==="internal"?"Private note":pretty(m.channel)}</Tag></header>
          <p>{m.body}</p>
          {m.direction==="outbound"&&<small className={"sd-delivery "+(m.deliveryState==="failed"||m.deliveryState==="uncertain"?"sd-delivery-alert":"")}>
           {deliveryLabel(m.deliveryState)}</small>}
         </article>)}
        </div>
        <form className="sd-composer" onSubmit={e=>void addNote(e)}>
         <div className="sd-compose-tabs"><Tag tone="warning">🔒 Internal note</Tag><span>Public reply unavailable in this sandbox</span></div>
         <label htmlFor="supportInternalNote" className="sd-visually-hidden">Internal note text</label>
         <textarea id="supportInternalNote" placeholder="Add a private note for the support team..." maxLength={10000}
          value={note} onChange={e=>setNote(e.target.value)} rows={3}/>
         <div className="sd-compose-bottom"><small>Saved only to the synthetic database. No emails sent.</small>
          <button disabled={busy||!note.trim()} type="submit" className="sd-button sd-button-primary">{busy?"Saving...":"Save private note"}</button></div>
        </form>
       </>}
      </section>
      <aside className="sd-customer-column" aria-label="Customer and service context">
       <div className="sd-panel-heading"><strong>Customer context</strong></div>
       {selected?<div className="sd-context">
        <h3>Conversation identity</h3>
        <div className="sd-context-value"><span>Customer</span><strong>{selected.clientId||"Not linked"}</strong></div>
        <div className="sd-context-value"><span>Synthetic sender</span><strong>{sender||"No inbound email"}</strong></div>
        <div className="sd-context-value"><span>Assigned agent</span><strong>{selected.assignedTo||"Unassigned"}</strong></div>
        <div className="sd-context-value"><span>Created by</span><strong>{selected.createdBy}</strong></div>
        <hr/>
        <h3>Related service jobs</h3>
        {links.length?links.map(l=><div className="sd-related" key={l.jobId}>▣ {l.jobId}</div>):<p>No related jobs linked.</p>}
        <form onSubmit={e=>void link(e)}><label htmlFor="linkJobId">Link existing synthetic job ID</label>
         <input id="linkJobId" placeholder="e.g. jobA" value={jobId} onChange={e=>setJobId(e.target.value)} maxLength={128}/>
         <button disabled={busy||!jobId.trim()} type="submit" className="sd-button sd-button-secondary">Link job</button></form>
        <hr/><h3>Service level</h3><p>SLA countdown not enabled. No deadline is being calculated.</p>
       </div>:<p className="sd-muted">Select a ticket to see its context.</p>}
      </aside>
     </div>
    </>}
    {screen==="customers"&&<section className="sd-single-panel"><h2>Customer context</h2>
     <p>Customer profiles remain separate from legacy job and invoice records. This view shows only scoped support information already returned by the synthetic ticket API.</p>
     {selected?<><div className="sd-statrow"><Stat label="Linked customer ID" value={selected.clientId||"Unlinked"}/><Stat label="Known test sender" value={sender||"No inbound message"}/></div>
      <button className="sd-button sd-button-primary" onClick={()=>open(selected.id)}>Open selected conversation →</button></>:<Empty title="No customer selected" detail="Open a conversation from the inbox."/>}</section>}
    {screen==="jobs"&&<section className="sd-single-panel"><h2>Service jobs remain independent</h2>
     <p>Linking tickets to existing service jobs does not change estimates, stages, invoices or payments.</p>
     {links.length?links.map(l=><p key={l.jobId} className="sd-related">▣ Linked synthetic job: {l.jobId}</p>):<Empty title="No linked job" detail="Open a ticket and attach a same-tenant synthetic service job."/>}</section>}
    {screen==="reports"&&<section className="sd-single-panel"><h2>Support activity snapshot</h2><p>These counts are from the currently loaded page only—not organization-wide metrics or SLA performance.</p>
     <div className="sd-statrow"><Stat label="Tickets loaded" value={tickets.length}/><Stat label="Active (loaded)" value={activeCount}/><Stat label="Assigned to agentA (loaded)" value={agents}/><Stat label="New & unassigned (loaded)" value={unavailable}/></div>
     <p className="sd-muted">Accurate full-database reporting and SLA analytics require a separately reviewed reporting API.</p></section>}
    {screen==="mailbox"&&<section className="sd-single-panel"><h2>Mailbox setup</h2>
     <Tag tone="warning">Mock provider only</Tag><p>Phase 2 synthetic ingestion and durable outgoing queue exist as isolated backend test components. No mailbox credentials, real IMAP, SMTP, Gmail or Microsoft Graph connections are configured.</p>
     <div className="sd-checkrow"><span>① Create synthetic mailbox</span><strong>Test fixture only</strong></div>
     <div className="sd-checkrow"><span>② Verify mock sender</span><strong>Mock validation</strong></div>
     <div className="sd-checkrow"><span>③ Deliver real email</span><strong>Disabled</strong></div>
     <p className="sd-muted">Real mailbox connection controls intentionally do not exist in Phase 3.</p></section>}
   </div>
  </main>
  {createOpen&&<div className="sd-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false);}}>
   <form className="sd-modal" role="dialog" aria-modal="true" aria-labelledby="newTicketTitle" onSubmit={e=>void create(e)}>
    <div className="sd-modal-title"><h2 id="newTicketTitle">New synthetic ticket</h2><button type="button" aria-label="Close new ticket" onClick={()=>setCreateOpen(false)}>×</button></div>
    <label>Subject<input required minLength={3} maxLength={200} autoFocus value={newSubject} onChange={e=>setNewSubject(e.target.value)} placeholder="Describe the customer issue"/></label>
    <label>Priority<select value={newPriority} onChange={e=>setNewPriority(e.target.value as TicketPriority)}>{PRIORITIES.map(p=><option key={p} value={p}>{pretty(p)}</option>)}</select></label>
    <p>Creates a ticket in disposable test PostgreSQL only. No customer notification.</p>
    <button type="submit" disabled={busy||newSubject.trim().length<3} className="sd-button sd-button-primary">Create synthetic ticket</button>
   </form>
  </div>}
 </div>;
}
function Stat({label,value}:{label:string;value:string|number}){
 return <div className="sd-stat"><span>{label}</span><strong>{value}</strong></div>;
}
export function IsolatedSupportEntry(){
 const [valid]=useState(()=>{
  try{assertLocalSyntheticUrl(window.location);return true;}catch{return false;}
 });
 if(!valid)return <main role="alert">Support Desk workbench is restricted to local synthetic testing.</main>;
 return <SupportDeskSandbox/>;
}
