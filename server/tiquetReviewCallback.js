import crypto from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORG=/^[A-Za-z0-9._:-]{8,180}$/;
const JOB=/^[A-Za-z0-9:._-]{1,160}$/;
export class ReviewCallbackError extends Error {
  constructor(code,status){super(code);this.code=code;this.status=status;}
}
export function safeCallbackSecret(given,expected) {
  if(typeof given!=='string'||typeof expected!=='string'||expected.length<32)return false;
  const a=Buffer.from(given),b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export function parsePlanningCallback(b) {
  if(!b||typeof b!=='object'||Array.isArray(b)||!UUID.test(b.projectId)||
    !ORG.test(b.organizationId)||!JOB.test(b.jobId)||
    b.eventId!=='tiquet-review-'+b.projectId)
    throw new ReviewCallbackError('INVALID_CALLBACK',400);
  return {organizationId:b.organizationId,jobId:b.jobId,projectId:b.projectId};
}
export async function applyTiquetReviewCallback({db,event,afterCommit}) {
  let changed=null;
  // Single dedicated connection: validation, stage update and activity log
  // commit atomically. No call to updateJobStage from inside this transaction.
  const result=await db.transaction(async tx=>{
    const rows=await tx.query(
      'SELECT j.id,j.status,j.quoteApproved AS "quoteApproved",j.account_id,'+
      'j.title,j.timeLogs AS "timeLogs",j.timerStartedAt AS "timerStartedAt",j.assignedTo AS "assignedTo",j.stageAssignments AS "stageAssignments" '+
      'FROM tiquet_planning_outbox o '+
      'JOIN jobs j ON j.id=o.job_id AND j.account_id=o.account_id '+
      'JOIN accounts a ON a.id=o.account_id '+
      'WHERE j.id=$1 AND o.project_id=$2 AND a.hub_organization_id=$3 '+
      "AND o.status='sent' FOR UPDATE OF j",
      [event.jobId,event.projectId,event.organizationId]
    );
    const row=rows.rows[0];
    if(!row||!row.quoteApproved)throw new ReviewCallbackError('UNLINKED_TENANT_OR_JOB',404);
    if(['review','invoiced','completed','paid'].includes(row.status))
      return {ok:true,duplicate:true,status:row.status};
    if(row.status!=='in-progress')throw new ReviewCallbackError('INVALID_STAGE',409);
    const now=new Date().toISOString();
    let timeLogs=[];
    try { timeLogs=typeof row.timeLogs==='string' ? JSON.parse(row.timeLogs) : (row.timeLogs||[]); }
    catch { throw new ReviewCallbackError('INVALID_TIMER_STATE',409); }
    if(!Array.isArray(timeLogs))throw new ReviewCallbackError('INVALID_TIMER_STATE',409);
    if(row.timerStartedAt){
      const elapsed=(Date.now()-new Date(row.timerStartedAt).getTime())/(1000*60*60);
      if(Number.isFinite(elapsed)&&elapsed>0)timeLogs.push({
        id:crypto.randomUUID(),employeeId:row.assignedTo||'unassigned',
        startTime:row.timerStartedAt,endTime:now,status:row.status
      });
    }
    let assignments={};
    try { assignments=typeof row.stageAssignments==='string' ?
      JSON.parse(row.stageAssignments) : (row.stageAssignments||{}); }
    catch { throw new ReviewCallbackError('INVALID_ASSIGNMENTS',409); }
    const assignedTo=assignments.review||row.assignedTo;
    const updated=await tx.query(
      'UPDATE jobs SET status=$1,timeLogs=$2,timerStartedAt=$3,assignedTo=$4 '+
      "WHERE id=$5 AND account_id=$6 AND status='in-progress' RETURNING id",
      ['review',JSON.stringify(timeLogs),now,assignedTo,row.id,row.account_id]
    );
    if(updated.rows.length!==1)throw new ReviewCallbackError('CONCURRENT_STAGE',409);
    await tx.query(
      'INSERT INTO activity_logs(id,job_id,action,timestamp,"user",account_id) '+
      'VALUES($1,$2,$3,$4,$5,$6)',
      [crypto.randomUUID(),row.id,'Stage advanced to review (FFPRO Planner)',
       now,'FFPRO Planner',row.account_id]
    );
    changed={accountId:row.account_id,jobId:row.id,title:row.title,occurredAt:now};
    return {ok:true,duplicate:false,status:'review'};
  })();
  if(changed && typeof afterCommit==='function'){
    try {await afterCommit(changed);} catch {/* log separately in caller; no false rollback */ }
  }
  return result;
}
