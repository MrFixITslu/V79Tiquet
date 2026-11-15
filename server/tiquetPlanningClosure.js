import crypto from 'node:crypto';

const EVENT = (accountId,jobId) =>
  'tiquet-close-'+crypto.createHash('sha256')
    .update(JSON.stringify([accountId,jobId])).digest('hex').slice(0,48);

export async function queueTiquetPlanningClosure(tx,{accountId,jobId,invoicedAt}) {
  const eventId=EVENT(accountId,jobId);
  await tx.query(
    'INSERT INTO tiquet_planning_closure_outbox '+
    '(account_id,job_id,event_id,project_id,invoiced_at,status,attempts) '+
    'SELECT account_id,job_id,$3,project_id,$4,\'pending\',0 '+
    'FROM tiquet_planning_outbox '+
    "WHERE account_id=$1 AND job_id=$2 AND status='sent' AND project_id IS NOT NULL "+
    'ON CONFLICT(account_id,job_id) DO NOTHING',
    [accountId,jobId,eventId,invoicedAt]
  );
  return eventId;
}

export async function sendTiquetPlanningClosure({
  db,row,baseUrl,secret,fetchImpl=fetch
}) {
  if(!baseUrl||!/^https:\/\//.test(baseUrl)||!secret||secret.length<32)
    return {kind:'disabled'};
  const record=(await db.query(
    'SELECT a.hub_organization_id AS "organizationId",j.status '+
    'FROM tiquet_planning_closure_outbox c '+
    'JOIN accounts a ON a.id=c.account_id '+
    'JOIN jobs j ON j.id=c.job_id AND j.account_id=c.account_id '+
    'WHERE c.account_id=$1 AND c.job_id=$2 AND c.project_id=$3',
    [row.accountId,row.jobId,row.projectId])).rows[0];
  if(!record?.organizationId)return {kind:'retry',reason:'No provisioned organisation'};
  if(!['invoiced','completed','paid'].includes(record.status))
    return {kind:'retry',reason:'Tiquet stage not invoiced'};
  const response=await fetchImpl(
    baseUrl.replace(/\/$/,'')+'/api/gateway/webhooks/tiquet/planning/closed',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Tiquet-Planning-Secret':secret},
      body:JSON.stringify({organizationId:record.organizationId,
        jobId:row.jobId,projectId:row.projectId}),
      signal:AbortSignal.timeout(8500)
    });
  if(response.ok)return {kind:'sent'};
  if([401,403].includes(response.status))
    return {kind:'permanent',reason:'FFPRO rejected closure credentials ('+response.status+')'};
  return {kind:'retry',reason:'FFPRO closure not ready ('+response.status+')'};
}

export async function sweepTiquetPlanningClosure({
  db,baseUrl,secret,fetchImpl=fetch,limit=12
}) {
  if(!baseUrl||!/^https:\/\//.test(baseUrl)||!secret||secret.length<32)
    return {disabled:true,processed:0};
  const items=(await db.query(
    'SELECT account_id AS "accountId",job_id AS "jobId",project_id AS "projectId",'+
    'event_id AS "eventId" FROM tiquet_planning_closure_outbox '+
    "WHERE (status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=NOW())) "+
    "OR (status='sending' AND lease_until<NOW()) ORDER BY invoiced_at LIMIT $1",
    [limit])).rows;
  let processed=0;
  for(const item of items){
    const claimed=(await db.query(
      "UPDATE tiquet_planning_closure_outbox SET status='sending',"+
      "lease_until=NOW()+INTERVAL '45 seconds',attempts=attempts+1 "+
      'WHERE account_id=$1 AND job_id=$2 AND ('+
      "(status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=NOW()) "+
      "OR status='sending' AND lease_until<NOW())) RETURNING event_id",
      [item.accountId,item.jobId])).rows[0];
    if(!claimed)continue;
    processed++;
    let result;
    try {result=await sendTiquetPlanningClosure({db,row:item,baseUrl,secret,fetchImpl});}
    catch {result={kind:'retry',reason:'Closure gateway unavailable'};}
    const next=result.kind==='sent'?'sent':result.kind==='permanent'?'permanent':'retry';
    await db.query(
      'UPDATE tiquet_planning_closure_outbox SET status=$3,lease_until=NULL,last_error=$4,'+
      "next_attempt_at=CASE WHEN $3='retry' THEN NOW()+INTERVAL '5 minutes' ELSE NULL END,"+
      "delivered_at=CASE WHEN $3='sent' THEN NOW() ELSE delivered_at END "+
      'WHERE account_id=$1 AND job_id=$2 AND event_id=$5',
      [item.accountId,item.jobId,next,result.reason||null,item.eventId]
    );
  }
  return {disabled:false,processed};
}
