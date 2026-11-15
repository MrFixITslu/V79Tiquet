import {deliverPlanningApproval} from './tiquetPlanningOutbox.js';

export async function sweepTiquetPlanning({db,baseUrl,secret,fetchImpl=fetch,limit=12}) {
  if(!baseUrl||!secret||secret.length<32)return {disabled:true,processed:0};
  const candidates=(await db.query(
    "SELECT account_id AS \"accountId\",job_id AS \"jobId\",event_id AS \"eventId\","+
    "approved_at AS \"approvedAt\" FROM tiquet_planning_outbox "+
    "WHERE (status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=NOW())) "+
    "OR (status='sending' AND lease_until<NOW()) ORDER BY approved_at LIMIT $1",[limit]
  )).rows;
  let processed=0;
  for(const item of candidates){
    const claimed=(await db.query(
      "UPDATE tiquet_planning_outbox SET status='sending',lease_until=NOW()+INTERVAL '45 seconds',"+
      "attempts=attempts+1 WHERE account_id=$1 AND job_id=$2 AND "+
      "((status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=NOW())) "+
      "OR (status='sending' AND lease_until<NOW())) RETURNING event_id",
      [item.accountId,item.jobId])).rows[0];
    if(!claimed)continue;
    processed++;
    let result;
    try{
      result=await deliverPlanningApproval({db,fetchImpl,baseUrl,secret,row:item});
    }catch(e){
      result={kind:'retry',reason:'Gateway unavailable'};
    }
    if(result.kind==='sent'){
      await db.query(
        "UPDATE tiquet_planning_outbox SET status='sent',project_id=$3,lease_until=NULL,"+
        "last_error=NULL,delivered_at=NOW() WHERE account_id=$1 AND job_id=$2 AND event_id=$4",
        [item.accountId,item.jobId,result.projectId,item.eventId]);
    }else{
      const terminal=result.kind==='permanent';
      await db.query(
        "UPDATE tiquet_planning_outbox SET status=$3,lease_until=NULL,last_error=$4,"+
        "next_attempt_at=CASE WHEN $3='retry' THEN NOW()+INTERVAL '5 minutes' ELSE NULL END "+
        "WHERE account_id=$1 AND job_id=$2 AND event_id=$5",
        [item.accountId,item.jobId,terminal?'permanent':'retry',
          String(result.reason||result.kind).slice(0,200),item.eventId]);
    }
  }
  return {disabled:false,processed};
}
