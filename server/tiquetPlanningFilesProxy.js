const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORG=/^[A-Za-z0-9._:-]{8,180}$/;
const REVIEW_STAGES=new Set(['review','invoiced','completed','paid']);
const MAX_FILE=10*1024*1024;
export class PlanningFileProxyError extends Error{
  constructor(code,status=404){super(code);this.name='PlanningFileProxyError';this.code=code;this.status=status;}
}
export async function resolvePlanningFileScope(db,job){
  if(!job || !REVIEW_STAGES.has(job.status)||!job.account_id||!job.id)
    throw new PlanningFileProxyError('NOT_FOUND');
  const q=await db.query(
    'SELECT o.project_id AS "projectId",a.hub_organization_id AS "organizationId" '+
    'FROM tiquet_planning_outbox o JOIN accounts a ON a.id=o.account_id '+
    'WHERE o.account_id=$1 AND o.job_id=$2 AND o.status=$3 AND o.project_id IS NOT NULL',
    [job.account_id,job.id,'sent']);
  const data=q.rows[0];
  if(!data || !UUID.test(data.projectId) || !ORG.test(data.organizationId))
    throw new PlanningFileProxyError('NOT_FOUND');
  return {projectId:data.projectId,organizationId:data.organizationId,jobId:job.id};
}
function destination(baseUrl,scope,fileId){
  if(typeof baseUrl!=='string')throw new PlanningFileProxyError('UNAVAILABLE',503);
  let base;
  try{base=new URL(baseUrl);}
  catch{throw new PlanningFileProxyError('UNAVAILABLE',503);}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||
     base.pathname!=='/'&&base.pathname!=='')
    throw new PlanningFileProxyError('UNAVAILABLE',503);
  const suffix='/api/gateway/webhooks/tiquet/planning/'+scope.projectId+'/files';
  return base.origin+suffix+(fileId?'/'+fileId:'');
}
async function bodyBounded(response,maxBytes){
  const chunks=[];
  let length=0;
  if(!response.body?.getReader)throw new PlanningFileProxyError('UPSTREAM_INVALID',502);
  const reader=response.body.getReader();
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>maxBytes)throw new PlanningFileProxyError('FILE_TOO_LARGE',502);
      chunks.push(Buffer.from(value));
    }
  }finally{try{await reader.cancel()}catch{}}
  return Buffer.concat(chunks,length);
}
export async function proxyPlanningFiles({
  db,job,fileId=null,baseUrl,secret,fetchImpl=fetch
}){
  if(typeof secret!=='string'||secret.length<32)
    throw new PlanningFileProxyError('UNAVAILABLE',503);
  if(fileId!==null && !UUID.test(fileId))
    throw new PlanningFileProxyError('NOT_FOUND');
  const scope=await resolvePlanningFileScope(db,job);
  const url=destination(baseUrl,scope,fileId);
  let response;
  try{
    response=await fetchImpl(url,{
      method:'GET',
      headers:{
        'X-Tiquet-Planning-Secret':secret,
        'X-Tiquet-Organization-Id':scope.organizationId,
        'X-Tiquet-Job-Id':scope.jobId
      },
      redirect:'error',
      signal:AbortSignal.timeout(10000)
    });
  }catch{throw new PlanningFileProxyError('UPSTREAM_UNAVAILABLE',503);}
  if(!response.ok){
    if(response.status===404||response.status===403)
      throw new PlanningFileProxyError('NOT_FOUND');
    throw new PlanningFileProxyError('UPSTREAM_UNAVAILABLE',503);
  }
  const size=Number(response.headers.get('content-length')||0);
  if(!Number.isFinite(size)||size<0||
    size>(fileId?MAX_FILE:65536))
    throw new PlanningFileProxyError('FILE_TOO_LARGE',502);
  const bytes=await bodyBounded(response,fileId?MAX_FILE:65536);
  if(fileId){
    // Never forward an executable MIME type. Browser will be forced to download.
    const raw=String(response.headers.get('content-disposition')||'');
    const filename=raw.match(/filename="([^"]+)"/)?.[1]||'approved-document.bin';
    return {kind:'file',data:bytes,fileName:filename.replace(/[^A-Za-z0-9._ -]/g,'_').slice(0,120)};
  }
  let data;
  try{data=JSON.parse(bytes.toString('utf8'));}
  catch{throw new PlanningFileProxyError('UPSTREAM_INVALID',502);}
  if(!Array.isArray(data?.files)||data.files.length>25||
    data.files.some(f=>!UUID.test(f.id)||typeof f.name!=='string'))
    throw new PlanningFileProxyError('UPSTREAM_INVALID',502);
  return {kind:'list',files:data.files.map(f=>({
    id:f.id,name:f.name.slice(0,240),type:String(f.type||'application/octet-stream').slice(0,120),
    size:Number(f.size)||0
  }))};
}
