import crypto from 'node:crypto';
export const POLICY_TWENTY_PERCENT = 'twenty_percent';
export const POLICY_WAIVED = 'waived';
export const POLICY_PENDING = 'review_pending';

export function depositTerms(job) {
  const policy = job?.depositPolicy ?? job?.depositpolicy ?? null;
  const value = Math.max(0, Number(job?.amount || 0));
  if (!Number.isFinite(value)) throw new Error('Invalid invoice amount.');
  if (policy === POLICY_PENDING) return {policy,rate:0,amount:0,pending:true,waived:false};
  if (policy === POLICY_WAIVED) return {policy,rate:0,amount:0,pending:false,waived:true};
  if (policy === POLICY_TWENTY_PERCENT) return {policy,rate:0.2,
    amount:Math.round(value*20)/100,pending:false,waived:false};
  if (policy === null) return {policy:'legacy',rate:0.3,
    amount:Math.round(value*30)/100,pending:false,waived:false};
  throw new Error('Unrecognised deposit policy.');
}

export class DepositPolicyError extends Error {
  constructor(code, status=409) { super(code); this.code=code; this.status=status; }
}

export async function setReviewDepositPolicy({db,accountId,jobId,policy,actor}) {
  if (![POLICY_TWENTY_PERCENT,POLICY_WAIVED].includes(policy))
    throw new DepositPolicyError('INVALID_DEPOSIT_SELECTION',400);
  if (!accountId || !jobId || !actor) throw new DepositPolicyError('INVALID_REQUEST',400);
  return db.transaction(async(tx)=>{
    const found=(await tx.query(
      'SELECT id,status,depositPolicy AS "depositPolicy",'+
      'invoiceIssuedAt AS "invoiceIssuedAt",invoiceSentAt AS "invoiceSentAt" '+
      'FROM jobs WHERE id=$1 AND account_id=$2 FOR UPDATE',
      [jobId,accountId])).rows[0];
    if (!found) throw new DepositPolicyError('JOB_NOT_FOUND',404);
    if (found.status!=='review'||found.invoiceIssuedAt||found.invoiceSentAt)
      throw new DepositPolicyError('REVIEW_REQUIRED');
    const link=(await tx.query(
      'SELECT project_id FROM tiquet_planning_outbox WHERE account_id=$1 AND job_id=$2 '+
      "AND status='sent' AND project_id IS NOT NULL",
      [accountId,jobId])).rows[0];
    if (!link) throw new DepositPolicyError('FFPRO_PLANNING_NOT_LINKED');
    const money=(await tx.query(
      "SELECT COALESCE(SUM(amount),0) AS paid FROM payments "+
      "WHERE account_id=$1 AND jobId=$2 AND status='recorded'",
      [accountId,jobId])).rows[0];
    if (Number(money?.paid||0)>0.005)
      throw new DepositPolicyError('PAYMENT_ALREADY_RECORDED');
    if (found.depositPolicy===policy) return {policy,unchanged:true};
    const changed=await tx.query(
      'UPDATE jobs SET depositPolicy=$1 WHERE id=$2 AND account_id=$3 '+
      "AND status='review' AND invoiceIssuedAt IS NULL AND invoiceSentAt IS NULL RETURNING id",
      [policy,jobId,accountId]);
    if (!changed.rows.length) throw new DepositPolicyError('CONCURRENT_REVIEW_UPDATE');
    await tx.query(
      'INSERT INTO activity_logs (id,job_id,action,timestamp,"user",account_id) '+
      'VALUES($1,$2,$3,$4,$5,$6)',
      [crypto.randomUUID(),jobId,
       policy===POLICY_WAIVED?'Deposit requirement waived for invoice review':'Reviewer selected 20% deposit',
       new Date().toISOString(),actor,accountId]
    );
    return {policy,unchanged:false};
  })();
}
