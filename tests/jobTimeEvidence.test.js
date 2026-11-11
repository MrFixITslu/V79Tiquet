import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveJobTimeEvidence } from "../server/jobTimeEvidence.js";

const jobId="f81d4fae-7dec-4da9-b565-a6756350cdbb";
const logId="115f62f5-88d8-4a19-8c67-194361e6382d";
const entry={id:logId,employeeId:"technician-a",
  startTime:"2026-11-11T12:00:00.000Z",
  endTime:"2026-11-11T13:30:00.000Z"};
const job={id:jobId,timeLogs:JSON.stringify([entry]),timerStartedAt:null};
const source=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
test("service history reports actual elapsed duration, never invented labour or margin",()=>{
 const v=deriveJobTimeEvidence(job);
 assert.equal(v.recordedSeconds,5400);
 assert.equal(v.recordedMinutes,"90.00");
 assert.equal(v.recordedIntervals,1);
 assert.equal(v.lastRecordedEnd,entry.endTime);
 assert.equal(v.labourCost,null);
 assert.equal(v.verifiedProfitMargin,null);
 assert.equal(v.historicalHourlyRatesAvailable,false);
 assert.equal(v.completedTimesheetVerification,false);
 assert.equal(v.status,"duration_only_unverified");
});
test("open timer is not misreported as completed work",()=>{
 const v=deriveJobTimeEvidence({...job,timerStartedAt:"2026-11-11T14:00:00Z"});
 assert.equal(v.recordedMinutes,"90.00");
 assert.equal(v.activeTimerNotIncluded,true);
 assert.equal(v.status,"ongoing_unverified");
});
test("invalid, duplicated or impossible time evidence fails closed",()=>{
 const bad=[
  {timeLogs:"corrupt"},
  {timeLogs:JSON.stringify([{...entry,id:"not-uuid"}])},
  {timeLogs:JSON.stringify([entry,entry])},
  {timeLogs:JSON.stringify([{...entry,endTime:"2026-11-11T11:59:00Z"}])},
  {timeLogs:JSON.stringify([{...entry,endTime:"2026-11-29T11:59:00Z"}])},
  {timeLogs:JSON.stringify({not:"list"})},
 ];
 for(const b of bad)
  assert.throws(()=>deriveJobTimeEvidence({...job,...b}));
});
test("server exposes work duration only to authenticated tenant staff while flagged on",()=>{
 const part=source.slice(source.indexOf('app.get("/api/jobs/:id/work-evidence"'),
   source.indexOf('app.get("/api/jobs/:id/scope"'));
 for(const key of [
  "V79_ECOSYSTEM_V2_WORK_EVIDENCE_ENABLED",
  "requireAnyPagePermission",
  "WHERE id=? AND account_id=?",
  "deriveJobTimeEvidence(job)",
  "Cache-Control"
 ])assert.ok(part.includes(key),"Missing work-evidence safeguard "+key);
 assert.doesNotMatch(part,/INSERT INTO payments|UPDATE jobs|createPayroll|reconcileMargin/);
});
