import React, { useEffect, useMemo, useState } from "react";
import { Job, Employee, Client, BusinessSettings, PaymentRecord } from "../types";
import {
  FileText,
  Search,
  CheckCircle2,
  Clock,
  Eye,
  Plus,
  X,
  Loader2,
  Landmark,
} from "lucide-react";
import { JobDetailModal } from "./JobDetailModal";
import { api } from "../api";
import { formatMoney } from "../currency";

type PaymentResponse = {
  payment: PaymentRecord;
  job: Job;
  summary: { paidAmount: number; outstandingAmount: number; fullyPaid: boolean };
};

export function Invoices({
  jobs,
  setJobs,
  employees,
  clients,
  settings,
}: {
  jobs: Job[];
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  employees: Employee[];
  clients: Client[];
  settings: BusinessSettings;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentJob, setPaymentJob] = useState<Job | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const currency = settings.currency || "USD";

  const loadPayments = async () => {
    try {
      setPayments(await api.get<PaymentRecord[]>("/payments"));
      setPaymentError(null);
    } catch (error: any) {
      setPaymentError(error.message || "Could not load recorded payments.");
    }
  };

  useEffect(() => {
    loadPayments();
  }, []);

  const paidByJob = useMemo(() => {
    const totals = new Map<string, number>();
    for (const payment of payments) {
      if (payment.status !== "recorded") continue;
      totals.set(payment.jobId, (totals.get(payment.jobId) || 0) + Number(payment.amount || 0));
    }
    return totals;
  }, [payments]);

  const invoiceableJobs = jobs.filter(
    (job) =>
      (job.status === "invoiced" || job.status === "completed" || job.status === "paid") &&
      (job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.client.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalReceived = payments
    .filter((payment) => payment.status === "recorded")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const totalOutstanding = jobs
    .filter((job) => job.status === "invoiced" || job.status === "completed")
    .reduce((sum, job) => {
      const paid = paidByJob.get(job.id) || 0;
      return sum + Math.max(0, Number(job.amount || 0) - paid);
    }, 0);

  const selectedJob = jobs.find((job) => job.id === selectedJobId);

  const applyPaymentResult = async (result: PaymentResponse) => {
    setJobs((current) => current.map((job) => (job.id === result.job.id ? { ...job, ...result.job } : job)));
    setPaymentJob(null);
    await loadPayments();
  };

  return (
    <div className="space-y-6 max-w-[1540px] mx-auto">
      <div>
        <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Invoices & Payments</h2>
        <p className="text-slate-500 text-sm mt-1">
          Invoice status and cash received are tracked separately. A job can only become Paid after recorded payments cover its value.
        </p>
      </div>

      {paymentError && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {paymentError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <MetricCard
          label="Cash Received"
          value={formatMoney(totalReceived, currency)}
          helper={`${payments.filter((payment) => payment.status === "recorded").length} recorded payments`}
          icon={<CheckCircle2 className="w-5 h-5" />}
        />
        <MetricCard
          label="Outstanding"
          value={formatMoney(totalOutstanding, currency)}
          helper="Invoiced and completed work"
          icon={<Clock className="w-5 h-5" />}
        />
        <MetricCard
          label="Open Invoices"
          value={jobs.filter((job) => job.status === "invoiced").length.toString()}
          helper="Awaiting settlement"
          icon={<FileText className="w-5 h-5" />}
        />
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search invoices by job or client..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Job / Client</th>
                <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Invoice Value</th>
                <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Received</th>
                <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Outstanding</th>
                <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoiceableJobs.map((job) => {
                const received = paidByJob.get(job.id) || 0;
                const outstanding = Math.max(0, Number(job.amount || 0) - received);
                return (
                  <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{job.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{job.client}</p>
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-900">{formatMoney(job.amount || 0, currency)}</td>
                    <td className="px-5 py-4 font-semibold text-emerald-600">{formatMoney(received, currency)}</td>
                    <td className="px-5 py-4 font-semibold text-slate-900">{formatMoney(outstanding, currency)}</td>
                    <td className="px-5 py-4">
                      <span className={`text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${
                        job.status === "paid"
                          ? "bg-emerald-100 text-emerald-700"
                          : job.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : "bg-indigo-100 text-indigo-700"
                      }`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {outstanding > 0.005 && (
                          <button
                            onClick={() => setPaymentJob(job)}
                            className="px-3 py-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors flex items-center gap-2 text-xs font-bold"
                          >
                            <Plus className="w-4 h-4" />
                            Record Payment
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedJobId(job.id)}
                          className="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-2 text-xs font-bold"
                        >
                          <Eye className="w-4 h-4" />
                          View Invoice
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {invoiceableJobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-14 text-center text-slate-400">
                    <FileText className="w-10 h-10 opacity-25 mx-auto mb-3" />
                    No invoiced, completed, or paid jobs match this search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {paymentJob && (
        <RecordPaymentModal
          job={paymentJob}
          currency={currency}
          alreadyPaid={paidByJob.get(paymentJob.id) || 0}
          onClose={() => setPaymentJob(null)}
          onRecorded={applyPaymentResult}
        />
      )}

      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          employees={employees}
          clients={clients}
          settings={settings}
          onClose={() => setSelectedJobId(null)}
          onUpdate={(updatedJob) => {
            setJobs(jobs.map((job) => (job.id === updatedJob.id ? updatedJob : job)));
          }}
        />
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-slate-100 text-indigo-600 flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-black text-slate-900 mt-0.5">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{helper}</p>
      </div>
    </div>
  );
}

function RecordPaymentModal({
  job,
  currency,
  alreadyPaid,
  onClose,
  onRecorded,
}: {
  job: Job;
  currency: string;
  alreadyPaid: number;
  onClose: () => void;
  onRecorded: (result: PaymentResponse) => Promise<void>;
}) {
  const outstanding = Math.max(0, Number(job.amount || 0) - alreadyPaid);
  const [amount, setAmount] = useState(outstanding.toFixed(2));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<PaymentResponse>("/payments", {
        jobId: job.id,
        amount: Number(amount),
        method,
        reference,
        note,
        receivedAt: new Date(`${receivedAt}T12:00:00`).toISOString(),
      });
      await onRecorded(result);
    } catch (err: any) {
      setError(err.message || "Payment could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Landmark className="w-5 h-5 text-emerald-600" />
              Record Confirmed Payment
            </h3>
            <p className="text-xs text-slate-500 mt-1">{job.title} · {job.client}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            Record this only after you have independently confirmed receipt of the funds. This action can post the payment to FFPRO.
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Invoice value</div>
              <div className="font-bold text-slate-900 mt-1">{formatMoney(job.amount || 0, currency)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Outstanding</div>
              <div className="font-bold text-slate-900 mt-1">{formatMoney(outstanding, currency)}</div>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Amount received</span>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              max={outstanding}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Payment method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value)} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl">
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="card_external">Card / external processor</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Reference</span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} placeholder="Bank ref / receipt" className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl" />
            </label>
            <label>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Date received</span>
              <input required type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Internal note</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl resize-none" />
          </label>

          {error && <div className="text-sm text-rose-600">{error}</div>}
        </div>

        <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button disabled={submitting} type="submit" className="px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Record Payment
          </button>
        </div>
      </form>
    </div>
  );
}
