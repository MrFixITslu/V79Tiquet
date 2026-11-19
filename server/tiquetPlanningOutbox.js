import crypto from 'node:crypto';

export function planningEventId(accountId,jobId) {
  const hash=crypto.createHash('sha256').update(JSON.stringify([accountId,jobId])).digest('hex');
  return 'tiquet-plan-'+hash.slice(0,48);
}

export function planningApprovalPayload(row,job,organizationId) {
  if(!organizationId||!job?.id||!job?.title||!job?.client)
    throw new Error('Planning event requires organisation, job and customer.');
  return {
    eventId:row.eventId,organizationId,jobId:job.id,
    ticketNumber:String(job.id),customerName:String(job.client),
    jobTitle:String(job.title),approvedAt:row.approvedAt,
    approval:'client-quote-approved'
  };
}

export async function queueTiquetPlanningApproval(tx,{jobId,accountId,approvedAt}) {
  const id=planningEventId(accountId,jobId);
  await tx.query(
    'INSERT INTO tiquet_planning_outbox '+
    '(account_id,job_id,event_id,approved_at,status,attempts)'+
    " VALUES($1,$2,$3,$4,'pending',0) "+
    'ON CONFLICT(account_id,job_id) DO NOTHING',
    [accountId,jobId,id,approvedAt]
  );
  return id;
}

export async function deliverPlanningApproval({db,fetchImpl=fetch,baseUrl,secret,row}) {
  if(!baseUrl||!secret||secret.length<32)return {kind:'disabled'};
  if(!/^https:\/\//.test(baseUrl))return {kind:'disabled'};
  const job=(await db.query('SELECT id,title,client FROM jobs WHERE id=$1 AND account_id=$2',
    [row.jobId,row.accountId])).rows[0];
  const account=(await db.query('SELECT hub_organization_id FROM accounts WHERE id=$1',
    [row.accountId])).rows[0];
  if(!job)return {kind:'permanent',reason:'Ticket missing'};
  if(!account?.hub_organization_id)return {kind:'retry',reason:'Hub organisation not provisioned'};
  const payload=planningApprovalPayload(row,job,account.hub_organization_id);
  const response=await fetchImpl(baseUrl.replace(/\/$/,'')+
    '/api/gateway/webhooks/tiquet/planning/approved',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Tiquet-Planning-Secret':secret},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(8500)
    });
  if(response.ok){
    const body=await response.json();
    if(!body?.projectId)return {kind:'retry',reason:'FFPRO omitted project ID'};
    return {kind:'sent',projectId:body.projectId};
  }
  if(response.status===401||response.status===403||response.status===409)
    return {kind:'permanent',reason:'FFPRO rejected planning event ('+response.status+')'};
  return {kind:'retry',reason:'FFPRO not ready ('+response.status+')'};
}
