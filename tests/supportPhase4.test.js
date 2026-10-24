import test from "node:test";
import assert from "node:assert/strict";
import {addBusinessMinutes,businessMinutesBetween,isBusinessMinute,validateCalendar,
 currentSlaState,DEFAULT_TARGETS} from "../server/support/businessHours.js";
const saint=validateCalendar({timezone:"America/St_Lucia",startMinute:540,endMinute:1020});
test("business hours in Saint Lucia: Monday 9 AM + 2 hours",()=>{
 assert.equal(addBusinessMinutes("2026-10-26T13:00:00Z",120,saint),
  "2026-10-26T15:00:00.000Z");
 assert.equal(businessMinutesBetween("2026-10-26T13:00:00Z",
  "2026-10-26T15:00:00Z",saint),120);
 assert.equal(isBusinessMinute("2026-10-26T13:00:00Z",saint),true);
 assert.equal(isBusinessMinute("2026-10-26T12:59:00Z",saint),false);
});
test("weekends roll correctly, holidays extend the deadline",()=>{
 const friday="2026-10-30T20:00:00Z";
 assert.equal(addBusinessMinutes(friday,120,saint),"2026-11-02T14:00:00.000Z");
 const holiday={...saint,holidays:["2026-11-02"]};
 assert.equal(addBusinessMinutes(friday,120,holiday),"2026-11-03T14:00:00.000Z");
});
test("IANA DST transition does not invent the missing spring-forward hour",()=>{
 const ny=validateCalendar({timezone:"America/New_York",
  startMinute:60,endMinute:240,weekdays:["Sun"]});
 assert.equal(businessMinutesBetween("2026-03-08T06:00:00Z",
  "2026-03-08T08:00:00Z",ny),120);
 assert.equal(addBusinessMinutes("2026-03-08T06:00:00Z",120,ny),
  "2026-03-08T08:00:00.000Z");
});
test("fall DST moves UTC deadline while preserving local work hours",()=>{
 const ny=validateCalendar({timezone:"America/New_York"});
 assert.equal(addBusinessMinutes("2026-10-30T20:00:00Z",120,ny),
  "2026-11-02T15:00:00.000Z");
});
test("invalid calendars fail closed",()=>{
 for(const cal of [
  {timezone:"Mars/Phobos"},{startMinute:800,endMinute:400},
  {weekdays:[]},{weekdays:["Mon","Mon"]},
  {holidays:["2026-02-30"]},{holidays:["bad-date"]}
 ])assert.throws(()=>validateCalendar(cal));
 assert.throws(()=>addBusinessMinutes("not a date",30,saint));
 assert.throws(()=>addBusinessMinutes("2026-10-26T13:00:00Z",0,saint));
 assert.throws(()=>businessMinutesBetween("2026-10-26T16:00:00Z",
  "2026-10-26T13:00:00Z",saint));
});
test("only observed human reply marks first response; waiting states pause resolution",()=>{
 const t={status:"waiting_customer"};
 const p={timezone:"America/St_Lucia"};
 const r={first_response_due:"2026-10-26T14:00:00.000Z",
  resolution_due:"2026-10-26T16:00:00.000Z",first_response_at:null,resolved_at:null};
 const view=currentSlaState({ticket:t,policy:p,record:r,now:"2026-10-26T17:00:00Z"});
 assert.equal(view.firstResponse,"breached");
 assert.equal(view.resolution,"paused");
 assert.equal(view.paused,true);
 assert.equal(DEFAULT_TARGETS.high.first,120);
});

test("late accepted response and late resolution remain breached, never met",()=>{
 const base={first_response_due:"2026-10-26T15:00:00Z",
  resolution_due:"2026-10-26T17:00:00Z",
  first_response_at:"2026-10-26T15:01:00Z",
  resolved_at:"2026-10-26T17:01:00Z"};
 const status=currentSlaState({ticket:{status:"resolved"},policy:saint,
  record:base,now:"2026-10-26T18:00:00Z"});
 assert.equal(status.firstResponse,"breached");
 assert.equal(status.resolution,"breached");
 const onTime=currentSlaState({ticket:{status:"resolved"},policy:saint,
  record:{...base,first_response_at:"2026-10-26T14:59:00Z",
   resolved_at:"2026-10-26T16:59:00Z"},
  now:"2026-10-26T18:00:00Z"});
 assert.equal(onTime.firstResponse,"met");assert.equal(onTime.resolution,"met");
});
