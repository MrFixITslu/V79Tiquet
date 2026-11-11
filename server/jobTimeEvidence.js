/**
 * Read-only service time evidence. Existing Tiquet timer logs are a source
 * for elapsed time, NOT labour cost or payroll, because historical rates
 * are not snapshot alongside them. Fail closed on invalid logs.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function deriveJobTimeEvidence(job) {
  if(!job||!UUID.test(String(job.id||"")))
    throw new Error("Invalid job time identity");
  let logs;
  try{logs=job.timeLogs ? JSON.parse(job.timeLogs) : [];}
  catch{throw new Error("Invalid recorded time history");}
  if(!Array.isArray(logs)||logs.length>10000)
    throw new Error("Recorded time history incomplete");
  const ids=new Set();let milliseconds=0;
  let latestEnd=null;
  for(const entry of logs){
    if(!entry||typeof entry!=="object"||Array.isArray(entry)||
       !UUID.test(String(entry.id||""))||ids.has(entry.id))
      throw new Error("Invalid or duplicated time evidence ID");
    ids.add(entry.id);
    const start=Date.parse(entry.startTime),end=Date.parse(entry.endTime);
    if(!Number.isFinite(start)||!Number.isFinite(end)||
       end<=start||end-start>7*24*60*60*1000)
      throw new Error("Unverified time interval");
    milliseconds+=end-start;
    if(!latestEnd||end>latestEnd)latestEnd=end;
  }
  if(!Number.isSafeInteger(milliseconds))
    throw new Error("Time evidence overflow");
  const timerActive=Boolean(job.timerStartedAt);
  return Object.freeze({
    jobId:job.id,
    recordedSeconds:Math.floor(milliseconds/1000),
    recordedMinutes:(milliseconds/60000).toFixed(2),
    recordedIntervals:logs.length,
    lastRecordedEnd:latestEnd?new Date(latestEnd).toISOString():null,
    activeTimerNotIncluded:timerActive,
    historicalHourlyRatesAvailable:false,
    labourCost:null,
    completedTimesheetVerification:false,
    verifiedProfitMargin:null,
    status:timerActive?"ongoing_unverified":"duration_only_unverified",
  });
}
