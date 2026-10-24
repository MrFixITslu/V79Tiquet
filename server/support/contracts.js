import crypto from "node:crypto";
export const STATUSES = new Set(["new","open","waiting_customer","resolved","closed"]);
export const PRIORITIES = new Set(["low","normal","high","critical"]);
const TRANSITIONS = {
 new:new Set(["open","resolved","closed"]),
 open:new Set(["waiting_customer","resolved","closed"]),
 waiting_customer:new Set(["open","resolved"]),
 resolved:new Set(["open","closed"]),
 closed:new Set(["open"])
};
export class SupportError extends Error {
 constructor(status,code,message=code){super(message);this.status=status;this.code=code;}
}
export function ensureObject(value) {
 if(!value||typeof value!=="object"||Array.isArray(value)) throw new SupportError(400,"INVALID_BODY");
 return value;
}
export function noExtraKeys(obj,allowed) {
 if(Object.keys(obj).some(k=>!allowed.includes(k))) throw new SupportError(400,"UNKNOWN_FIELD");
}
export function nonblank(value,max=200,min=1) {
 if(typeof value!=="string"||value.trim().length<min||value.trim().length>max)
  throw new SupportError(400,"INVALID_TEXT");
 return value.trim();
}
export function optionalId(value) {
 if(value==null||value==="") return null;
 if(typeof value!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new SupportError(400,"INVALID_ID");
 return value;
}
export function keyOf(headers) {
 const v=headers["idempotency-key"];
 if(typeof v!=="string"||!/^[A-Za-z0-9_-]{8,128}$/.test(v))
  throw new SupportError(400,"IDEMPOTENCY_KEY_REQUIRED");
 return v;
}
export function parseCreate(body) {
 const b=ensureObject(body);noExtraKeys(b,["subject","clientId","priority","assignedTo"]);
 const priority=b.priority??"normal";
 if(!PRIORITIES.has(priority)) throw new SupportError(400,"INVALID_PRIORITY");
 return {subject:nonblank(b.subject,200,3),clientId:optionalId(b.clientId),
  priority,assignedTo:optionalId(b.assignedTo)};
}
export function parsePatch(body,oldStatus) {
 const b=ensureObject(body);noExtraKeys(b,["subject","status","priority","assignedTo"]);
 if(!Object.keys(b).length) throw new SupportError(400,"EMPTY_PATCH");
 const p={};
 if("subject" in b) p.subject=nonblank(b.subject,200,3);
 if("priority" in b){
  if(!PRIORITIES.has(b.priority)) throw new SupportError(400,"INVALID_PRIORITY");
  p.priority=b.priority;
 }
 if("assignedTo" in b) p.assignedTo=optionalId(b.assignedTo);
 if("status" in b){
  if(!STATUSES.has(b.status)) throw new SupportError(400,"INVALID_STATUS");
  if(b.status!==oldStatus&&!TRANSITIONS[oldStatus]?.has(b.status))
   throw new SupportError(409,"INVALID_TRANSITION");
  p.status=b.status;
 }
 return p;
}
export function versionOf(header) {
 if(header===undefined) throw new SupportError(428,"IF_MATCH_REQUIRED");
 const m=typeof header==="string" && /^"([1-9]\d{0,9})"$/.exec(header);
 if(!m) throw new SupportError(400,"INVALID_IF_MATCH");
 return Number(m[1]);
}
export function listArgs(query) {
 const limit=query.limit===undefined?25:Number(query.limit);
 if(!Number.isInteger(limit)||limit<1||limit>100) throw new SupportError(400,"INVALID_LIMIT");
 const status=query.status??null,priority=query.priority??null;
 if(status!==null&&!STATUSES.has(status)) throw new SupportError(400,"INVALID_STATUS");
 if(priority!==null&&!PRIORITIES.has(priority)) throw new SupportError(400,"INVALID_PRIORITY");
 return {limit,status,priority,search:query.search===undefined?"":nonblank(query.search,160),
  assignedTo:optionalId(query.assigneeId)};
}
export const digest = value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function makeCursor(row,filter){
 return Buffer.from(JSON.stringify({at:row.cursorUpdatedAt??new Date(row.updatedAt).toISOString(),id:row.id,
  filter:digest(filter)})).toString("base64url");
}
export function readCursor(input,filter) {
 if(input==null) return null;
 if(typeof input!=="string"||input.length>512||!/^[A-Za-z0-9_-]+$/.test(input))
  throw new SupportError(400,"INVALID_CURSOR");
 try {
  const c=JSON.parse(Buffer.from(input,"base64url").toString("utf8"));
  if(c?.filter!==digest(filter)||typeof c.id!=="string"||
     !/^[A-Za-z0-9_-]{1,128}$/.test(c.id)||typeof c.at!=="string"||
     !Number.isFinite(Date.parse(c.at))) throw new Error("bad");
  return c;
 }catch{throw new SupportError(400,"INVALID_CURSOR");}
}
