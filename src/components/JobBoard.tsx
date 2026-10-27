import React, { useState, useMemo, useEffect } from "react";
import { readTiquetJobId, tiquetNavigationPath } from "../navigationState.js";
import { Job, JobStatus, ActivityLogEntry, COLUMNS, Employee, Client, BusinessSettings } from "../types";
import { Plus, Search, Filter, Clock, DollarSign, ArrowRight, ArrowLeft, User, ShieldAlert, Sparkles, Folder } from "lucide-react";
import { JobModal } from "./JobModal";
import { JobDetailModal } from "./JobDetailModal";
import { formatMoney } from "../currency";

export function JobBoard({
  jobs,
  setJobs,
  employees,
  clients,
  settings,
  jobsLoading = false,
  jobsError = null,
  onRetryJobs,
}: {
  jobs: Job[];
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  employees: Employee[];
  clients: Client[];
  settings: BusinessSettings;
  jobsLoading?: boolean;
  jobsError?: string | null;
  onRetryJobs?: () => void;
}) {
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() => readTiquetJobId(window.location.search));

  // Restore an open ticket after refresh once its authorized job data arrives.
  useEffect(() => {
    const path = tiquetNavigationPath(window.location.href, "jobs", selectedJobId);
    if (path !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, "", path);
    }
  }, [selectedJobId]);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assignedFilter, setAssignedFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "board">(() => {
    try { return window.localStorage.getItem("v79-tiquet-jobs-view") === "board" ? "board" : "list"; }
    catch { return "list"; }
  });
  const [visibleCount, setVisibleCount] = useState(25);
  useEffect(() => {
    try { window.localStorage.setItem("v79-tiquet-jobs-view", viewMode); } catch { /* Storage may be disabled. */ }
  }, [viewMode]);
  useEffect(() => { setVisibleCount(25); }, [searchQuery, priorityFilter, assignedFilter]);


  const moveJob = (jobId: string, newStatus: JobStatus) => {
    setJobs(
      jobs.map((job) => {
        if (job.id === jobId) {
          const newLog: ActivityLogEntry = {
            id: crypto.randomUUID(),
            action: `Moved stage from ${job.status} to ${newStatus}`,
            timestamp: new Date().toISOString(),
            user: "Team Staff",
          };
          return {
            ...job,
            status: newStatus,
            activityLog: [...(job.activityLog || []), newLog],
          };
        }
        return job;
      })
    );
  };

  const handleSaveNewJob = (jobData: Omit<Job, "id" | "createdAt">) => {
    const newJob: Job = {
      ...jobData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    setJobs([newJob, ...jobs]);
  };

  // Filtered jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const matchQuery =
        !searchQuery.trim() ||
        j.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.client.toLowerCase().includes(searchQuery.toLowerCase());
      const matchPriority = priorityFilter === "all" || j.priority === priorityFilter;
      const matchAssigned = assignedFilter === "all" || j.assignedTo === assignedFilter;
      return matchQuery && matchPriority && matchAssigned;
    });
  }, [jobs, searchQuery, priorityFilter, assignedFilter]);

  const selectedJob = jobs.find((j) => j.id === selectedJobId);
  const visibleJobs = filteredJobs.slice(0, visibleCount);
  const stageLabel = (status: JobStatus) => COLUMNS.find((column) => column.id === status)?.label || status;
  const statusTone = (status: JobStatus) =>
    status === "paid" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    status === "completed" ? "text-teal-700 bg-teal-50 border-teal-200" :
    status === "in-progress" ? "text-blue-700 bg-blue-50 border-blue-200" :
    "text-slate-700 bg-slate-100 border-slate-200";


  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Top Header & Filter Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Jobs Pipeline</h2>
          <p className="text-slate-500 text-sm mt-1">
            Track, advance, and deliver client jobs through verified project lifecycle stages.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Jobs display mode" className="flex p-1 gap-1 rounded-xl border border-slate-200 bg-slate-100">
            <button type="button" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${viewMode === "list" ? "bg-[#0758B8] text-white" : "text-slate-700 hover:bg-white"}`}>List</button>
            <button type="button" aria-pressed={viewMode === "board"} onClick={() => setViewMode("board")}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${viewMode === "board" ? "bg-[#0758B8] text-white" : "text-slate-700 hover:bg-white"}`}>Board</button>
          </div>

          {/* Quick Filter Search */}
          <div className="flex items-center min-h-11 w-full sm:w-auto bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-2xs">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              aria-label="Filter jobs by title or client"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by job or client..."
              className="bg-transparent border-none outline-none ml-2 text-sm w-full sm:w-44 text-slate-700 placeholder-slate-400"
            />
          </div>

          {/* Priority filter */}
          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 font-medium outline-none shadow-2xs cursor-pointer"
          >
            <option value="all">All Priorities</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Low Priority</option>
          </select>

          {/* Assigned filter */}
          <select
            aria-label="Filter by assignee"
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 font-medium outline-none shadow-2xs cursor-pointer"
          >
            <option value="all">All Assignees</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.name}>
                {emp.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setIsNewModalOpen(true)}
            disabled={jobsLoading || Boolean(jobsError)}
            className="min-h-11 bg-[#0758B8] hover:bg-[#164783] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm ml-auto sm:ml-0"
          >
            <Plus className="w-4 h-4" />
            New Job
          </button>
        </div>
      </div>

      {jobsLoading && <p role="status" className="rounded-xl border border-slate-300 p-4 text-sm text-slate-300">Loading jobs…</p>}
      {jobsError && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">Jobs are unavailable; the pipeline and editing controls are paused. {onRetryJobs && <button type="button" onClick={onRetryJobs} className="min-h-11 px-2 font-semibold underline">Retry</button>}</div>}
      {/* Readable list on desktop and genuinely responsive cards on phones. All actions
          open the same existing job detail dialog; no lifecycle or payment changes. */}
      {!jobsLoading && !jobsError && viewMode === "list" && (
        <section aria-label="Jobs list" className="space-y-3">
          <p role="status" className="text-sm text-slate-500">
            Showing {Math.min(visibleCount, filteredJobs.length)} of {filteredJobs.length} matching jobs
          </p>
          <div className="hidden md:block rounded-2xl bg-white border border-slate-200 overflow-x-auto shadow-xs">
            <table className="w-full min-w-[780px] text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-xs uppercase tracking-wide text-slate-600">
                  <th scope="col" className="px-4 py-4 font-bold">Job / Client</th>
                  <th scope="col" className="px-4 py-4 font-bold">Stage</th>
                  <th scope="col" className="px-4 py-4 font-bold">Priority</th>
                  <th scope="col" className="px-4 py-4 font-bold">Assigned</th>
                  <th scope="col" className="px-4 py-4 font-bold">Due</th>
                  <th scope="col" className="px-4 py-4 font-bold text-right">Value</th>
                  <th scope="col" className="px-4 py-4 font-bold text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4 max-w-[260px]">
                      <button type="button" onClick={() => setSelectedJobId(job.id)} className="font-bold text-[#0758B8] text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{job.title}</button>
                      <div className="text-xs text-slate-500 mt-1 truncate">{job.client}</div>
                    </td>
                    <td className="px-4 py-4"><span className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${statusTone(job.status)}`}>{stageLabel(job.status)}</span></td>
                    <td className="px-4 py-4 text-sm text-slate-700 capitalize">{job.priority}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">{job.assignedTo || "Unassigned"}</td>
                    <td className="px-4 py-4 text-sm text-slate-600 whitespace-nowrap">{job.dueDate ? new Date(job.dueDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-900 text-right whitespace-nowrap">{typeof job.amount === "number" ? formatMoney(job.amount, settings.currency) : "—"}</td>
                    <td className="px-4 py-4 text-right"><button type="button" onClick={() => setSelectedJobId(job.id)} aria-label={`View ${job.title}`} className="min-h-11 px-3 text-sm text-[#0758B8] font-semibold hover:underline">View</button></td>
                  </tr>
                ))}
                {visibleJobs.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-slate-500">No jobs match your filters. Try clearing the search or filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3">
            {visibleJobs.map((job) => (
              <article key={job.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setSelectedJobId(job.id)} className="min-h-11 text-left font-bold text-[#0758B8] hover:underline">{job.title}</button>
                  <span className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold ${statusTone(job.status)}`}>{stageLabel(job.status)}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1">{job.client}</p>
                <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3 mt-3 text-sm">
                  <div><span className="block text-xs text-slate-500">Priority</span><span className="capitalize font-semibold text-slate-700">{job.priority}</span></div>
                  <div><span className="block text-xs text-slate-500">Assigned</span><span className="font-semibold text-slate-700">{job.assignedTo || "Unassigned"}</span></div>
                  <div><span className="block text-xs text-slate-500">Due</span><span className="text-slate-700">{job.dueDate ? new Date(job.dueDate).toLocaleDateString() : "—"}</span></div>
                  <div><span className="block text-xs text-slate-500">Value</span><span className="font-semibold text-slate-700">{typeof job.amount === "number" ? formatMoney(job.amount, settings.currency) : "—"}</span></div>
                </div>
                <button type="button" onClick={() => setSelectedJobId(job.id)} className="mt-3 w-full min-h-11 rounded-xl bg-[#0758B8] text-white font-semibold text-sm">View job details</button>
              </article>
            ))}
            {visibleJobs.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No jobs match your filters.</div>}
          </div>
          {filteredJobs.length > visibleCount && (
            <button type="button" onClick={() => setVisibleCount((n) => n + 25)}
              className="w-full sm:w-auto min-h-11 px-5 rounded-xl border border-slate-300 bg-white font-semibold text-sm text-slate-700 hover:bg-slate-50">
              Show 25 more jobs
            </button>
          )}
        </section>
      )}
      {/* Existing Kanban remains selectable for stage-management workflows. */}
      {!jobsLoading && !jobsError && viewMode === "board" && <div className="flex-1 flex gap-5 overflow-x-auto pb-4 items-stretch min-h-[580px]">
        {COLUMNS.map((col) => {
          const colJobs = filteredJobs.filter((j) => j.status === col.id);
          return (
            <div key={col.id} className="flex-shrink-0 w-80 flex flex-col">
              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 px-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">{col.label}</h3>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-700">
                    {colJobs.length}
                  </span>
                </div>
              </div>

              {/* Column Content Card Container */}
              <div className="v79-job-lane flex-1 rounded-2xl p-3 flex flex-col gap-3 overflow-y-auto border shadow-2xs">
                {colJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    moveJob={moveJob}
                    currency={settings.currency}
                    onClick={() => setSelectedJobId(job.id)}
                  />
                ))}

                {colJobs.length === 0 && (
                  <div className="h-32 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-center p-4 text-slate-400">
                    <Folder className="w-6 h-6 mb-1 opacity-40 text-slate-400" />
                    <span className="text-xs font-medium">No jobs in {col.label.toLowerCase()}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>}

      {/* New Job Modal */}
      <JobModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSave={handleSaveNewJob}
        employees={employees}
        clients={clients}
      />

      {/* Detailed Job Modal */}
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          employees={employees}
          clients={clients}
          settings={settings}
          onClose={() => setSelectedJobId(null)}
          onUpdate={(updatedJob) => {
            setJobs(jobs.map((j) => (j.id === updatedJob.id ? updatedJob : j)));
          }}
        />
      )}
    </div>
  );
}

const JobCard: React.FC<{
  job: Job;
  moveJob: (id: string, status: JobStatus) => void;
  currency: string;
  onClick: () => void;
}> = ({ job, moveJob, currency, onClick }) => {
  const currentIndex = COLUMNS.findIndex((c) => c.id === job.status);
  const prevStatus = job.status !== "paid" && currentIndex > 0 ? COLUMNS[currentIndex - 1].id : null;
  const nextStatus = job.status === "completed"
    ? null
    : currentIndex < COLUMNS.length - 1
      ? COLUMNS[currentIndex + 1].id
      : null;

  return (
    <div
      className="bg-white p-4 rounded-xl shadow-xs border border-slate-200/80 hover:border-sky-300 group hover:shadow-md transition-all flex flex-col gap-3 relative"
    >
      {/* Top Meta Bar */}
      <div className="flex justify-between items-center">
        <span
          className={`text-[9px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded-md ${
            job.priority === "high"
              ? "bg-red-50 text-red-700 border border-red-200/60"
              : job.priority === "medium"
              ? "bg-amber-50 text-amber-700 border border-amber-200/60"
              : "bg-slate-100 text-slate-600 border border-slate-200"
          }`}
        >
          {job.priority}
        </span>
        <span className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
          <Clock className="w-3 h-3 text-slate-400" />
          {new Date(job.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>

      {/* Title & Client */}
      <div>
        <h4 className="font-bold text-slate-900 text-sm leading-snug">
          <button type="button" onClick={onClick} className="block w-full min-h-11 text-left text-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`Open job: ${job.title}`}>{job.title}</button>
        </h4>
        <p className="text-xs text-slate-500 mt-1 font-medium truncate">{job.client}</p>
      </div>

      {/* Tags */}
      {job.tags && job.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {job.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-md"
            >
              {tag}
            </span>
          ))}
          {job.tags.length > 3 && (
            <span className="text-[9px] font-semibold text-slate-400">+{job.tags.length - 3}</span>
          )}
        </div>
      )}

      {/* Due Date Notice */}
      {job.dueDate && (
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-md w-fit border border-amber-200/60">
          <Clock className="w-3 h-3" />
          Due {new Date(job.dueDate).toLocaleDateString()}
        </div>
      )}

      {/* Footer Details & Workflow Controls */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-auto">
        <div className="flex items-center gap-2.5 text-slate-500">
          {job.amount !== undefined && (
            <div className="text-xs font-extrabold text-slate-800">
              {formatMoney(job.amount, currency)}
            </div>
          )}
          {job.assignedTo && (
            <div
              className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold"
              title={`Assigned to ${job.assignedTo}`}
            >
              {job.assignedTo.charAt(0)}
            </div>
          )}
        </div>

        {/* Workflow Advance / Regress Buttons */}
        <div className="flex items-center gap-1">
          {prevStatus && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                moveJob(job.id, prevStatus);
              }}
              className="min-h-11 min-w-11 bg-slate-100 text-slate-600 hover:bg-slate-200 p-2 rounded-lg flex items-center justify-center text-sm font-semibold focus-visible:outline focus-visible:outline-2"
              title={`Move back to ${COLUMNS.find((c) => c.id === prevStatus)?.label}`}
              aria-label={`Move ${job.title} back to ${COLUMNS.find((c) => c.id === prevStatus)?.label}`}
            >
              <ArrowLeft className="w-3 h-3" />
            </button>
          )}

          {nextStatus && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                moveJob(job.id, nextStatus);
              }}
              className="min-h-11 bg-[#0758B8] text-white hover:bg-[#164783] px-3 py-2 rounded-lg flex items-center gap-1 text-sm font-bold focus-visible:outline focus-visible:outline-2"
              title={`Advance to ${COLUMNS.find((c) => c.id === nextStatus)?.label}`}
              aria-label={`Advance ${job.title} to ${COLUMNS.find((c) => c.id === nextStatus)?.label}`}
            >
              Advance <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
