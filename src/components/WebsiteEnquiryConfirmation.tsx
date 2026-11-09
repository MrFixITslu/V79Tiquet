import { useState } from "react";
import { CheckCircle2, Mail, Phone, RefreshCw, Users } from "lucide-react";
import { api } from "../api";
import type { Job } from "../types";

export function WebsiteEnquiryConfirmation({
  job, canConfirmCustomer = false, onChanged,
}: {
  job: Job;
  canConfirmCustomer?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const [notes, setNotes] = useState(job.contactNotes || "");
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const reference = "TQ-" + job.id.replaceAll("-", "").slice(0, 12).toUpperCase();
  const closed = ["cancelled", "completed", "paid"].includes(job.status);
  const converted = !!job.crmCustomerId;

  async function recordCall(outcome: "confirmed" | "callback" | "declined") {
    if (!canConfirmCustomer || closed || working || notes.trim().length < 10) return;
    if (outcome === "confirmed" && !window.confirm(
      "The customer has agreed to proceed. Convert the website CRM lead to a customer? This action is recorded."
    )) return;
    setWorking(true);
    setFeedback(null);
    try {
      const result = await api.post<{
        success: boolean; customerId?: string; crmLeadId?: number; crmSyncStatus?: string;
      }>("/jobs/" + encodeURIComponent(job.id) + "/customer-confirmation", {
        outcome, notes: notes.trim()
      });
      await onChanged?.();
      setFeedback({ error: false, message: outcome === "confirmed"
        ? "Customer confirmed and linked to website CRM" +
          (result.customerId ? " (" + result.customerId + ")" : "") + "."
        : outcome === "callback"
          ? "Call Back recorded. Ticket remains open."
          : "Declined recorded. Review whether the ticket should be cancelled." });
    } catch (error: any) {
      await onChanged?.().catch(() => {});
      setFeedback({
        error: true, message: error.message || "The action was not completed. Review the ticket before retrying."
      });
    } finally {
      setWorking(false);
    }
  }

  async function retryAcknowledgement() {
    if (!canConfirmCustomer || working) return;
    setWorking(true); setFeedback(null);
    try {
      const result = await api.post<{ acknowledged: boolean }>(
        "/jobs/" + encodeURIComponent(job.id) + "/retry-acknowledgement"
      );
      await onChanged?.();
      setFeedback({ error: !result.acknowledged,
        message: result.acknowledged
          ? "Email service accepted the acknowledgement. Inbox delivery is not yet confirmed."
          : "Acknowledgement is queued for another attempt." });
    } catch (error: any) {
      setFeedback({ error: true, message: error.message || "Could not retry the acknowledgement." });
    } finally { setWorking(false); }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4"
      aria-label="Website enquiry and customer confirmation">
      <div className="flex flex-wrap gap-3 justify-between items-start">
        <div>
          <h4 className="font-semibold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" /> Website enquiry
          </h4>
          <p className="text-xs text-slate-500 mt-1">Reference: <strong>{reference}</strong></p>
        </div>
        <span className="text-xs bg-white border border-slate-200 px-3 py-1 rounded-full text-slate-700">
          {converted ? "Confirmed customer" : job.contactOutcome === "callback" ? "Call back" :
            job.contactOutcome === "declined" ? "Declined" :
              job.contactOutcome === "confirmed" ? "CRM sync pending" : "Awaiting customer call"}
        </span>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
        <p className="flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Acknowledgement: <strong>{job.websiteAckStatus === "sent" ? "Accepted by email service" :
            job.websiteAckStatus === "failed" ? "Retry required" :
              job.websiteAckStatus === "sending" ? "Sending" : "Queued"}</strong>
        </p>
        {job.websiteAckStatus === "failed" && canConfirmCustomer && (
          <button type="button" onClick={retryAcknowledgement} disabled={working}
            className="mt-2 text-indigo-700 font-semibold flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className="w-3.5 h-3.5" /> Retry acknowledgement
          </button>
        )}
      </div>
      {converted && (
        <p className="flex gap-2 items-center text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4" />
          Linked to website CRM lead #{job.crmLeadId}, customer {job.crmCustomerId}.
        </p>
      )}
      {job.contactNotes && (
        <p className="text-xs text-slate-600">Last recorded call: {job.contactNotes}</p>
      )}
      {canConfirmCustomer && !closed && !converted && (
        <div className="space-y-2">
          <label htmlFor={"customer-call-" + job.id} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Phone className="w-4 h-4" /> Customer confirmation call notes
          </label>
          <textarea id={"customer-call-" + job.id} value={notes} onChange={e => setNotes(e.target.value)}
            maxLength={1500} rows={3} placeholder="Who you spoke to, what they requested, what was agreed, and next steps"
            className="w-full rounded-xl p-3 bg-white border border-slate-300 text-slate-900 text-sm"
            disabled={working} />
          <p className="text-xs text-slate-500">Minimum 10 characters. Only confirming creates or links a CRM customer.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={working || notes.trim().length < 10}
              onClick={() => recordCall("confirmed")}
              className="rounded-lg px-3 py-2 bg-emerald-700 text-white font-semibold text-xs disabled:opacity-50">
              {job.contactOutcome === "confirmed" ? "Retry CRM conversion" : "Confirm & Convert to Customer"}
            </button>
            <button type="button" disabled={working || notes.trim().length < 10}
              onClick={() => recordCall("callback")}
              className="rounded-lg px-3 py-2 border border-slate-300 bg-white text-slate-800 text-xs disabled:opacity-50">
              Call Back
            </button>
            <button type="button" disabled={working || notes.trim().length < 10}
              onClick={() => recordCall("declined")}
              className="rounded-lg px-3 py-2 border border-slate-300 bg-white text-slate-800 text-xs disabled:opacity-50">
              Declined
            </button>
          </div>
        </div>
      )}
      {!canConfirmCustomer && !converted && (
        <p className="text-xs text-slate-500">An administrator must confirm a customer before CRM conversion.</p>
      )}
      {feedback && <p role="status" className={"text-xs rounded-lg p-2 " +
        (feedback.error ? "text-red-800 bg-red-50" : "text-emerald-800 bg-emerald-50")}>
        {feedback.message}
      </p>}
    </section>
  );
}
