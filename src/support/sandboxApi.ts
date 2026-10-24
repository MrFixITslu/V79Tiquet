// Phase 3 isolated UI adapter. This module is imported ONLY by the separate
// tests/support-ui HTML entry. It is not imported by production Tiquet.
export type TicketStatus="new"|"open"|"waiting_customer"|"resolved"|"closed";
export type TicketPriority="low"|"normal"|"high"|"critical";
export type SupportTicket={
 id:string;accountId:string;subject:string;clientId:string|null;status:TicketStatus;
 priority:TicketPriority;assignedTo:string|null;createdBy:string;version:number;
 createdAt:string;updatedAt:string
};
export type SupportMessage={
 id:string;ticketId:string;actorId:string;visibility:"internal"|"public";
 channel:"manual"|"portal"|"email";direction:"internal"|"inbound"|"outbound";
 deliveryState:"not_applicable"|"queued"|"sending"|"accepted"|"failed"|"uncertain"|"cancelled";
 body:string;createdAt:string
};
export type TicketPage={items:SupportTicket[];nextCursor:string|null};
export type MessagePage={items:SupportMessage[];nextCursor:string|null};
export type LinkedJob={jobId:string};
export type SyntheticSla={firstResponse:"running"|"breached"|"met";resolution:"running"|"paused"|"breached"|"met";paused:boolean;firstResponseDue:string;resolutionDue:string;timezone:string;source:"synthetic";asOf:string};
export type SyntheticPresence={agents:{actorId:string;mode:"viewing"|"drafting";ticketVersion:number;expiresAt:string}[];currentTicketVersion:number;asOf:string};
export type SyntheticAlert={id:string;ruleId:string;body:string;createdAt:string};
export class SupportApiError extends Error{
 status:number;code:string;
 constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
export function assertLocalSyntheticUrl(location:Pick<Location,"hostname"|"protocol">){
 if(location.protocol!=="http:"||!["127.0.0.1","localhost"].includes(location.hostname))
  throw new Error("Support workbench is only available on localhost");
}
function newKey(){return "synthetic_"+crypto.randomUUID().replaceAll("-","");}
export function createSandboxApi(base="",actor="agentA",account="demoA",fetcher:typeof fetch=fetch){
 // Demo-only header identity for test fixture server. A real deployment
 // MUST use Hub session authentication instead.
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(actor)||!/^[a-zA-Z0-9_-]{1,64}$/.test(account))
  throw new Error("Invalid synthetic identity");
 const request=async <T>(url:string,init:RequestInit={})=>{
  const res=await fetcher(base+"/api/support/staff"+url,{
   ...init,credentials:"same-origin",
   headers:{"x-synthetic-user":actor,"x-synthetic-account":account,
    ...(init.body?{"Content-Type":"application/json"}:{}),...init.headers}
  });
  const raw=await res.json().catch(()=>({}));
  if(!res.ok)throw new SupportApiError(res.status,raw.code||"HTTP_"+res.status,
   raw.error||"Support action failed");
  return {data:raw as T,etag:res.headers.get("ETag")};
 };
 return {
  list:async(filters:{status?:TicketStatus;search?:string;assigneeId?:string;cursor?:string}={})=>{
   const qs=new URLSearchParams({limit:"25"});
   if(filters.status)qs.set("status",filters.status);
   if(filters.search)qs.set("search",filters.search);
   if(filters.assigneeId)qs.set("assigneeId",filters.assigneeId);
   if(filters.cursor)qs.set("cursor",filters.cursor);
   return (await request<TicketPage>("/tickets?"+qs)).data;
  },
  get:async(id:string)=>request<SupportTicket>("/tickets/"+encodeURIComponent(id)),
  messages:async(id:string)=>(await request<MessagePage>("/tickets/"+encodeURIComponent(id)+"/messages?limit=25")).data,
  create:async(subject:string,priority:TicketPriority)=>{
   return (await request<SupportTicket>("/tickets",{
    method:"POST",headers:{"Idempotency-Key":newKey()},body:JSON.stringify({subject,priority})
   })).data;
  },
  patch:async(id:string,version:number,fields:Partial<Pick<SupportTicket,"status"|"priority"|"subject">>)=>{
   return (await request<SupportTicket>("/tickets/"+encodeURIComponent(id),{
    method:"PATCH",headers:{"If-Match":'"'+version+'"'},
    body:JSON.stringify(fields)
   })).data;
  },
  note:async(id:string,body:string)=>{
   return (await request<SupportMessage>("/tickets/"+encodeURIComponent(id)+"/messages",{
    method:"POST",headers:{"Idempotency-Key":newKey()},
    body:JSON.stringify({body,visibility:"internal"})
   })).data;
  },
  links:async(id:string)=>(await request<{items:LinkedJob[]}>("/tickets/"+encodeURIComponent(id)+"/links")).data,
  linkJob:async(id:string,jobId:string)=>{
   return (await request<{kind:string;targetId:string;created:boolean}>(
    "/tickets/"+encodeURIComponent(id)+"/links",{
    method:"POST",body:JSON.stringify({kind:"service_job",targetId:jobId})
   })).data;
  },
  sla:async(id:string)=>(await request<SyntheticSla>("/phase4/tickets/"+encodeURIComponent(id)+"/sla")).data,
  presence:async(id:string)=>(await request<SyntheticPresence>("/phase4/tickets/"+encodeURIComponent(id)+"/presence")).data,
  heartbeat:async(id:string,version:number,mode:"viewing"|"drafting")=>
   (await request<{mode:string;version:number;expiresAt:string}>("/phase4/tickets/"+encodeURIComponent(id)+"/presence",{
    method:"PUT",headers:{"If-Match":'"'+version+'"'},body:JSON.stringify({mode})
   })).data,
  alerts:async(id:string)=>(await request<{items:SyntheticAlert[]}>("/phase4/tickets/"+encodeURIComponent(id)+"/alerts")).data,
  evaluateRules:async(id:string)=>(await request<{newRules:string[];source:string;notificationsSent:number}>(
   "/phase4/tickets/"+encodeURIComponent(id)+"/automations/evaluate",{method:"POST",body:JSON.stringify({})})).data
 };
}
export type SandboxApi=ReturnType<typeof createSandboxApi>;
