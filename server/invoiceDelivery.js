/**
 * V79 invoicing email policy. This sends the customer's invoice portal
 * link, not a fabricated PDF attachment or payment confirmation.
 *
 * Only the exact owner account configured through environment variables
 * may copy Vision79's invoice mailbox. Other SaaS tenants remain private.
 */
const MAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function invoiceDeliveryDecision(job) {
  if(!job)return {ok:false,reason:"job_not_found"};
  if(!["invoiced","completed","paid"].includes(job.status))
    return {ok:false,reason:"invoice_not_ready"};
  if(!MAIL.test(String(job.clientEmail||"")))
    return {ok:false,reason:"recipient_missing"};
  const amount=Number(job.amount);
  if(!Number.isFinite(amount)||amount<=0)
    return {ok:false,reason:"invoice_amount_missing"};
  return {ok:true};
}
export function invoiceCcForAccount(accountId,config=process.env) {
  const target=String(config.V79_TIQUET_INVOICE_CC_ACCOUNT_ID||"").trim();
  const cc=String(config.V79_TIQUET_INVOICE_CC_EMAIL||"").trim();
  if(!target || target!==String(accountId)) return {cc:null,required:false};
  if(!MAIL.test(cc))return {cc:null,required:true,error:"cc_not_configured"};
  return {cc,required:true};
}
