import {SupportError} from "./contracts.js";
const DAY=new Set(["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]);
export const DEFAULT_TARGETS=Object.freeze({
 critical:{first:30,resolve:240},high:{first:120,resolve:480},
 normal:{first:480,resolve:1440},low:{first:960,resolve:2880}
});
export function validateCalendar(input){
 if(!input||typeof input!=="object"||Array.isArray(input))
  throw new SupportError(400,"INVALID_SLA_CALENDAR");
 const timezone=input.timezone??"America/St_Lucia";
 if(typeof timezone!=="string"||timezone.length>80)throw new SupportError(400,"INVALID_TIMEZONE");
 try{new Intl.DateTimeFormat("en-US",{timeZone:timezone}).format(new Date());}
 catch{throw new SupportError(400,"INVALID_TIMEZONE");}
 const start=input.startMinute??540,end=input.endMinute??1020;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>1440||end<=start)
  throw new SupportError(400,"INVALID_BUSINESS_HOURS");
 const weekdays=input.weekdays??["Mon","Tue","Wed","Thu","Fri"];
 if(!Array.isArray(weekdays)||weekdays.length<1||weekdays.length>7||
    weekdays.some(day=>!DAY.has(day))||new Set(weekdays).size!==weekdays.length)
  throw new SupportError(400,"INVALID_WEEKDAYS");
 const holidays=input.holidays??[];
 if(!Array.isArray(holidays)||holidays.length>366||holidays.some(v=>
  typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v)||
  new Date(v+"T00:00:00Z").toISOString().slice(0,10)!==v))
  throw new SupportError(400,"INVALID_HOLIDAYS");
 return Object.freeze({timezone,startMinute:start,endMinute:end,
  weekdays:[...weekdays],holidays:[...new Set(holidays)]});
}
const formatters=new Map();
function parts(date,timezone){
 let f=formatters.get(timezone);
 if(!f){
  f=new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",
   day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hourCycle:"h23"});
  formatters.set(timezone,f);
 }
 const p=Object.fromEntries(f.formatToParts(date).map(x=>[x.type,x.value]));
 return {day:p.weekday,date:p.year+"-"+p.month+"-"+p.day,
  minute:Number(p.hour)*60+Number(p.minute)};
}
export function isBusinessMinute(utc,calendar){
 const c=validateCalendar(calendar);
 const d=parts(new Date(utc),c.timezone);
 return c.weekdays.includes(d.day)&&!c.holidays.includes(d.date)&&
  d.minute>=c.startMinute&&d.minute<c.endMinute;
}
function timeMs(iso){
 const n=new Date(iso).getTime();
 if(!Number.isFinite(n))throw new SupportError(400,"INVALID_SLA_DATE");
 return Math.floor(n/60000)*60000;
}
// Minute-resolution deterministic UTC iteration correctly follows IANA DST.
// Guard to 180 days so corrupted targets cannot lock up the worker.
export function addBusinessMinutes(from,amount,calendar){
 const c=validateCalendar(calendar);
 if(!Number.isInteger(amount)||amount<1||amount>30000)
  throw new SupportError(400,"INVALID_SLA_TARGET");
 let now=timeMs(from),remaining=amount;
 for(let minute=0;minute<180*1440;minute++){
  if(isOpenAt(now,c))remaining--;
  now+=60000;
  if(!remaining)return new Date(now).toISOString();
 }
 throw new SupportError(422,"SLA_CALENDAR_NO_CAPACITY");
}
export function businessMinutesBetween(from,to,calendar){
 const c=validateCalendar(calendar);
 let now=timeMs(from),end=timeMs(to),total=0;
 if(end<now)throw new SupportError(400,"REVERSED_SLA_WINDOW");
 if(end-now>180*86400000)throw new SupportError(422,"SLA_WINDOW_TOO_LARGE");
 while(now<end){if(isOpenAt(now,c))total++;now+=60000;}
 return total;
}
function isOpenAt(ms,c){
 const local=parts(new Date(ms),c.timezone);
 return c.weekdays.includes(local.day)&&!c.holidays.includes(local.date)&&
  local.minute>=c.startMinute&&local.minute<c.endMinute;
}
export function currentSlaState({ticket,policy,record,now}){
 const moment=new Date(now);
 if(!Number.isFinite(moment.getTime()))throw new SupportError(400,"INVALID_SLA_DATE");
 const paused=ticket.status==="waiting_customer";
 const first=record.first_response_at? "met":
  moment.getTime()>new Date(record.first_response_due).getTime()?"breached":"running";
 const resolution=record.resolved_at?"met":paused?"paused":
  moment.getTime()>new Date(record.resolution_due).getTime()?"breached":"running";
 return {firstResponse:first,resolution,paused,firstResponseDue:record.first_response_due,
  resolutionDue:record.resolution_due,timezone:policy.timezone,
  asOf:moment.toISOString(),source:"synthetic"};
}
