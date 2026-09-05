import React, { useState, useMemo } from "react";
import { Job, JobStatus, ActivityLogEntry, COLUMNS, Employee, Client, BusinessSettings } from "../types";
import { Plus, Search, Filter, Clock, DollarSign, ArrowRight, ArrowLeft, User, ShieldAlert, Sparkles, Folder } from "lucide-react";
import { JobModal } from "./JobModal";
import { JobDetailModal } from "./JobDetailModal";

export function JobBoard({
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
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assignedFilter, setAssignedFilter] = useState<string>("all");

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

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Top Header & Filter Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Job Production Pipeline</h2>
          <p className="text-slate-500 text-xs mt-1">
            Track, advance, and deliver client jobs through verified project lifecycle stages.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Quick Filter Search */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-2xs">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by job or client..."
              className="bg-transparent border-none outline-none ml-2 text-xs w-44 text-slate-700 placeholder-slate-400"
            />
          </div>

          {/* Priority filter */}
          <select
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
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer ml-auto sm:ml-0"
          >
            <Plus className="w-4 h-4" />
            New Job
          </button>
        </div>
      </div>

      {/* Kanban Board Columns Container */}
      <div className="flex-1 flex gap-5 overflow-x-auto pb-4 items-stretch min-h-[580px]">
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
              <div className="flex-1 bg-slate-100/70 rounded-2xl p-3 flex flex-col gap-3 overflow-y-auto border border-slate-200/60 shadow-2xs">
                {colJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    moveJob={moveJob}
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
      </div>

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
  onClick: () => void;
}> = ({ job, moveJob, onClick }) => {
  const currentIndex = COLUMNS.findIndex((c) => c.id === job.status);
  const prevStatus = currentIndex > 0 ? COLUMNS[currentIndex - 1].id : null;
  const nextStatus = currentIndex < COLUMNS.length - 1 ? COLUMNS[currentIndex + 1].id : null;

  return (
    <div
      onClick={onClick}
      className="bg-white p-4 rounded-xl shadow-xs border border-slate-200/80 hover:border-indigo-200 group hover:shadow-md transition-all cursor-pointer flex flex-col gap-3 relative"
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
        <h4 className="font-bold text-slate-900 text-sm leading-snug group-hover:text-indigo-600 transition-colors">
          {job.title}
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
              ${job.amount.toLocaleString()}
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
              className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-100 text-slate-600 hover:bg-slate-200 p-1.5 rounded-lg flex items-center text-xs font-semibold"
              title={`Move back to ${COLUMNS.find((c) => c.id === prevStatus)?.label}`}
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
              className="opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-1 rounded-lg flex items-center gap-1 text-[11px] font-bold"
              title={`Advance to ${COLUMNS.find((c) => c.id === nextStatus)?.label}`}
            >
              Advance <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
