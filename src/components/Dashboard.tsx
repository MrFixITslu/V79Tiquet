import React, { useEffect, useMemo, useState } from "react";
import { Job } from "../types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Briefcase,
  Clock,
  AlertCircle,
  History,
  PieChart as PieIcon,
  DollarSign,
  Layers,
  FileText,
  Activity,
  UserRoundX,
  CalendarClock,
} from "lucide-react";
import { D3PieChartWidget } from "./D3PieChartWidget";
import { api } from "../api";
import { formatMoney } from "../currency";

type PaymentSummary = {
  received: number;
  count: number;
  outstandingInvoices: number;
};

export function Dashboard({ jobs, currency = "USD" }: { jobs: Job[]; currency?: string }) {
  const [payments, setPayments] = useState<PaymentSummary>({
    received: 0,
    count: 0,
    outstandingInvoices: 0,
  });

  useEffect(() => {
    api.get<PaymentSummary>("/payments/summary")
      .then(setPayments)
      .catch(() => {
        // The dashboard remains usable if the financial summary is temporarily unavailable.
      });
  }, [jobs]);

  const activeJobs = jobs.filter(
    (job) => ["request", "estimation", "in-progress", "review", "invoiced"].includes(job.status)
  );
  const inProgressJobs = jobs.filter((job) => job.status === "in-progress");
  const pendingInvoicedJobs = jobs.filter((job) => job.status === "invoiced");

  const overdueJobs = useMemo(() => {
    const now = Date.now();
    return jobs.filter((job) =>
      job.dueDate &&
      !["completed", "paid"].includes(job.status) &&
      new Date(job.dueDate).getTime() < now
    );
  }, [jobs]);

  const attentionJobs = useMemo(() => {
    return jobs
      .filter((job) => !["completed", "paid"].includes(job.status))
      .map((job) => {
        const overdue = Boolean(job.dueDate && new Date(job.dueDate).getTime() < Date.now());
        const unassigned = !job.assignedTo;
        const highPriority = job.priority === "high";
        const score = (overdue ? 4 : 0) + (unassigned ? 2 : 0) + (highPriority ? 1 : 0);
        return { job, overdue, unassigned, highPriority, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [jobs]);

  const priorityData = [
    { name: "High", count: activeJobs.filter((job) => job.priority === "high").length, fill: "#ef4444" },
    { name: "Medium", count: activeJobs.filter((job) => job.priority === "medium").length, fill: "#f59e0b" },
    { name: "Low", count: activeJobs.filter((job) => job.priority === "low").length, fill: "#3b82f6" },
  ];

  const recentActivity = jobs
    .flatMap((job) => (job.activityLog || []).map((log) => ({ ...log, jobTitle: job.title })))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-5 max-w-[1540px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Service Operations</h2>
          <p className="text-slate-400 text-sm mt-1">Work requiring attention, invoice exposure and confirmed cash across this workspace.</p>
        </div>
        <div className="text-xs text-slate-400">
          {jobs.length} total jobs · {payments.count} recorded payments
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Active Jobs"
          value={String(activeJobs.length)}
          helper={`${inProgressJobs.length} currently in progress`}
          icon={<Activity className="w-5 h-5" />}
        />
        <KpiCard
          label="Due / Overdue"
          value={String(overdueJobs.length)}
          helper={overdueJobs.length ? "Needs scheduling attention" : "No overdue work"}
          icon={<CalendarClock className="w-5 h-5" />}
          emphasis={overdueJobs.length > 0 ? "warning" : undefined}
        />
        <KpiCard
          label="Outstanding Invoices"
          value={formatMoney(payments.outstandingInvoices, currency)}
          helper={`${pendingInvoicedJobs.length} invoice${pendingInvoicedJobs.length === 1 ? "" : "s"} awaiting settlement`}
          icon={<FileText className="w-5 h-5" />}
        />
        <KpiCard
          label="Cash Collected"
          value={formatMoney(payments.received, currency)}
          helper="Confirmed payment ledger only"
          icon={<DollarSign className="w-5 h-5" />}
          emphasis="positive"
        />
      </div>

      <div className="bg-[#091728] rounded-2xl border border-[#1a3854] overflow-hidden">
        <div className="p-5 border-b border-[#18324b] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              Attention Required
            </h3>
            <p className="text-xs text-slate-400 mt-1">Overdue, unassigned and high-priority work rises to the top.</p>
          </div>
          <span className="text-xs text-slate-500">{attentionJobs.length} shown</span>
        </div>
        {attentionJobs.length ? (
          <div className="divide-y divide-[#18324b]">
            {attentionJobs.map(({ job, overdue, unassigned, highPriority }) => (
              <div key={job.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-white/[0.018]">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100 truncate">{job.title}</div>
                  <div className="text-xs text-slate-400 mt-1">{job.client} · {job.status.replace("-", " ")}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {overdue && <Signal icon={<Clock className="w-3 h-3" />} label="Overdue" tone="warning" />}
                  {unassigned && <Signal icon={<UserRoundX className="w-3 h-3" />} label="Unassigned" />}
                  {highPriority && <Signal icon={<AlertCircle className="w-3 h-3" />} label="High priority" tone="danger" />}
                  {job.dueDate && (
                    <span className="text-[11px] text-slate-400 px-2 py-1">
                      Due {new Date(job.dueDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-9 text-center text-sm text-slate-400">No active jobs currently need escalation.</div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-[#091728] p-5 rounded-2xl border border-[#1a3854] shadow-xs">
          <div className="border-b border-[#18324b] pb-4 mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-sky-400" />
              Pipeline Distribution
            </h3>
            <p className="text-slate-400 text-xs mt-1">Current work across each service stage.</p>
          </div>
          <div className="min-h-[285px]">
            <D3PieChartWidget jobs={jobs} />
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#091728] p-5 rounded-2xl border border-[#1a3854] shadow-xs">
          <div className="border-b border-[#18324b] pb-4 mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-orange-400" />
              Active Priority Workload
            </h3>
            <p className="text-slate-400 text-xs mt-1">Open work grouped by priority.</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#17324d" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={{ stroke: "#244560" }} />
                <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={{ stroke: "#244560" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0b1a2c", border: "1px solid #1a3854", borderRadius: "10px", color: "#f8fafc", fontSize: "12px" }}
                  cursor={{ fill: "rgba(255,122,0,.05)" }}
                />
                <Bar dataKey="count" fill="#FF7A00" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-[#091728] rounded-2xl border border-[#1a3854] overflow-hidden">
        <div className="p-5 border-b border-[#18324b] flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-sky-400" />
            Recent Activity
          </h3>
          <span className="text-[11px] font-semibold text-slate-400">Latest workspace events</span>
        </div>
        <div className="divide-y divide-[#18324b]">
          {recentActivity.length ? recentActivity.map((activity) => (
            <div key={activity.id} className="p-4 flex items-center justify-between gap-4 hover:bg-white/[0.018]">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-200 truncate">
                  {activity.action} <span className="text-slate-500 font-normal">·</span> <span className="text-sky-400">{activity.jobTitle}</span>
                </p>
                <p className="text-xs text-slate-500 mt-1">By {activity.user}</p>
              </div>
              <span className="text-xs text-slate-500 shrink-0">
                {new Date(activity.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </div>
          )) : (
            <div className="text-center py-10 text-slate-400 text-sm">No recent activity.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  helper,
  icon,
  emphasis,
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
  emphasis?: "warning" | "positive";
}) {
  const iconClass = emphasis === "warning"
    ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
    : emphasis === "positive"
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : "text-sky-400 bg-sky-500/10 border-sky-500/20";

  return (
    <div className="bg-[#091728] p-5 rounded-2xl border border-[#1a3854] shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</div>
          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-2">{value}</div>
        </div>
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${iconClass}`}>{icon}</div>
      </div>
      <div className="text-xs text-slate-500 mt-2">{helper}</div>
    </div>
  );
}

function Signal({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "warning" | "danger";
}) {
  const classes = tone === "danger"
    ? "bg-rose-500/10 border-rose-500/20 text-rose-300"
    : tone === "warning"
      ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
      : "bg-slate-500/10 border-slate-500/20 text-slate-300";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold ${classes}`}>
      {icon}{label}
    </span>
  );
}
