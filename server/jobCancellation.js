/**
 * Customer-requested cancellation decision. A cancellation is a closed
 * service state, not evidence of a refund, invoice void or payment reversal.
 * The ledger must stay untouched and staff must resolve billing separately.
 */
const CANCELLABLE=new Set(["request","estimation","in-progress","review"]);
export function cancellationDecision(job,recordedAmount) {
  if(!job)return {allowed:false,reason:"not_found"};
  if(job.status==="cancelled")return {allowed:true,alreadyCancelled:true};
  if(!Number.isFinite(recordedAmount)||recordedAmount<0)
    return {allowed:false,reason:"ledger_unavailable"};
  if(recordedAmount>0)
    return {allowed:false,reason:"payment_requires_review"};
  if(!CANCELLABLE.has(job.status))
    return {allowed:false,reason:"manual_financial_closure_required"};
  return {allowed:true,alreadyCancelled:false};
}
export function validTicketDate(value) {
  if(value===undefined||value===null||value==="")return true;
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
