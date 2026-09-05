import React from "react";
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
  CheckCircle2,
  Clock,
  AlertCircle,
  History,
  PieChart as PieIcon,
  DollarSign,
  TrendingUp,
  Layers,
} from "lucide-react";
import { D3PieChartWidget } from "./D3PieChartWidget";

export function Dashboard({ jobs }: { jobs: Job[] }) {
  const inProgressJobs = jobs.filter((j) => j.status === "in-progress");
  const completedJobs = jobs.filter((j) => j.status === "completed" || j.status === "paid");
  const highPriorityJobs = jobs.filter((j) => j.priority === "high");
  const totalRevenue = jobs
    .filter((j) => j.status === "paid")
    .reduce((sum, j) => sum + (j.amount || 0), 0);

  const priorityData = [
    { name: "High", count: jobs.filter((j) => j.priority === "high").length, fill: "#ef4444" },
    { name: "Medium", count: jobs.filter((j) => j.priority === "medium").length, fill: "#f59e0b" },
    { name: "Low", count: jobs.filter((j) => j.priority === "low").length, fill: "#3b82f6" },
  ];

  const recentActivity = jobs
    .flatMap((j) => (j.activityLog || []).map((l) => ({ ...l, jobTitle: j.title })))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">System Performance & Operations</h2>
          <p className="text-slate-500 text-xs mt-1">Real-time status across production pipelines, team velocity, and revenue.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>{jobs.length} Active System Jobs</span>
          </div>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          icon={<Briefcase className="w-5 h-5 text-indigo-600" />}
          label="Total Pipeline"
          value={jobs.length}
          subtext="All active job records"
          bgColor="bg-indigo-50"
          borderColor="border-indigo-100"
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-purple-600" />}
          label="In Progress"
          value={inProgressJobs.length}
          subtext="Active production stage"
          bgColor="bg-purple-50"
          borderColor="border-purple-100"
        />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          label="Delivered & Paid"
          value={completedJobs.length}
          subtext="Finalized assignments"
          bgColor="bg-emerald-50"
          borderColor="border-emerald-100"
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5 text-amber-600" />}
          label="Confirmed Revenue"
          value={`$${totalRevenue.toLocaleString()}`}
          subtext="Deposits & paid invoices"
          bgColor="bg-amber-50"
          borderColor="border-amber-100"
        />
      </div>

      {/* Visual Data & D3 Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* D3 Pie Interactive */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="border-b border-slate-100 pb-4 mb-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-indigo-600" />
                Pipeline Stage Distribution (D3 Interactive)
              </h3>
              <span className="text-[11px] font-semibold text-slate-400">Live Stage Telemetry</span>
            </div>
            <p className="text-slate-400 text-xs mt-0.5">Hover slices to inspect active stage job telemetry and counts.</p>
          </div>

          <div className="flex-1 flex flex-col justify-center min-h-[300px]">
            <D3PieChartWidget jobs={jobs} />
          </div>
        </div>

        {/* Priority Histogram */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="border-b border-slate-100 pb-4 mb-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              Priority Workload Distribution
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">Active priority level allocation.</p>
          </div>

          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "none",
                    borderRadius: "8px",
                    color: "#f8fafc",
                    fontSize: "12px",
                  }}
                  cursor={{ fill: "rgba(241, 245, 249, 0.4)" }}
                />
                <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-around pt-4 border-t border-slate-100 text-xs text-slate-500">
            {priorityData.map((p) => (
              <div key={p.name} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.fill }} />
                <span className="font-semibold text-slate-700">{p.name}: {p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent System Activity Feed */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            Live System Activity Feed
          </h3>
          <span className="text-[11px] font-semibold text-slate-400">Chronological Event Stream</span>
        </div>

        <div className="divide-y divide-slate-100">
          {recentActivity.length > 0 ? (
            recentActivity.map((activity) => (
              <div key={activity.id} className="p-4 hover:bg-slate-50/60 transition-colors flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">
                      {activity.action} <span className="text-slate-400 font-normal">on</span>{" "}
                      <span className="text-indigo-600 font-semibold">{activity.jobTitle}</span>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Initiated by {activity.user}</p>
                  </div>
                </div>

                <span className="text-[11px] text-slate-400 font-medium shrink-0">
                  {new Date(activity.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} •{" "}
                  {new Date(activity.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-slate-400 text-xs">
              No recent pipeline activities logged.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtext,
  bgColor,
  borderColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtext: string;
  bgColor: string;
  borderColor: string;
}) {
  return (
    <div className={`bg-white p-5 rounded-2xl border ${borderColor} shadow-xs flex flex-col justify-between`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`w-9 h-9 rounded-xl ${bgColor} flex items-center justify-center`}>{icon}</div>
      </div>
      <div className="mt-4">
        <p className="text-2xl font-black text-slate-900 tracking-tight">{value}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">{subtext}</p>
      </div>
    </div>
  );
}
