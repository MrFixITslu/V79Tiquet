import React, { useState, useEffect, useMemo } from "react";
import { Search, Briefcase, User, FileText, Settings, PlusCircle, ArrowRight, X, Clock, CreditCard } from "lucide-react";
import { Job, Client } from "../types";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: Job[];
  clients: Client[];
  onSelectTab: (tab: string) => void;
  onSelectJob: (job: Job) => void;
  onSelectClient: (client: Client) => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  jobs,
  clients,
  onSelectTab,
  onSelectJob,
  onSelectClient,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          setQuery("");
          setSelectedIndex(0);
        }
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Default navigation shortcuts
      return [
        { type: "nav", id: "dashboard", title: "Go to Dashboard", subtitle: "Analytics and system overview", icon: Briefcase, action: () => onSelectTab("dashboard") },
        { type: "nav", id: "jobs", title: "View Jobs Pipeline", subtitle: "Kanban board & job stages", icon: Briefcase, action: () => onSelectTab("jobs") },
        { type: "nav", id: "new-request", title: "Create New Request", subtitle: "Submit a new job ticket", icon: PlusCircle, action: () => onSelectTab("new-request") },
        { type: "nav", id: "clients", title: "View Clients", subtitle: "Directory of client accounts", icon: User, action: () => onSelectTab("clients") },
        { type: "nav", id: "invoices", title: "View Invoices", subtitle: "Billing & invoice management", icon: FileText, action: () => onSelectTab("invoices") },
        { type: "nav", id: "settings", title: "Workspace Settings", subtitle: "Branding, email templates, & plans", icon: Settings, action: () => onSelectTab("settings") },
      ];
    }

    const items: Array<{
      type: "job" | "client" | "nav";
      id: string;
      title: string;
      subtitle: string;
      icon: any;
      action: () => void;
    }> = [];

    // Filter Jobs
    jobs
      .filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.client.toLowerCase().includes(q) ||
          j.status.toLowerCase().includes(q)
      )
      .slice(0, 5)
      .forEach((j) => {
        items.push({
          type: "job",
          id: j.id,
          title: j.title,
          subtitle: `Client: ${j.client} • Stage: ${j.status} • Priority: ${j.priority}`,
          icon: Briefcase,
          action: () => {
            onSelectTab("jobs");
            onSelectJob(j);
            onClose();
          },
        });
      });

    // Filter Clients
    clients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.company && c.company.toLowerCase().includes(q)) ||
          c.email.toLowerCase().includes(q)
      )
      .slice(0, 4)
      .forEach((c) => {
        items.push({
          type: "client",
          id: c.id,
          title: c.name,
          subtitle: `${c.company || "Direct Client"} • ${c.email}`,
          icon: User,
          action: () => {
            onSelectTab("clients");
            onSelectClient(c);
            onClose();
          },
        });
      });

    // Nav matches
    const navs = [
      { id: "dashboard", title: "Dashboard", subtitle: "System metrics", icon: Briefcase },
      { id: "jobs", title: "Jobs Board", subtitle: "Manage active jobs", icon: Briefcase },
      { id: "clients", title: "Clients Directory", subtitle: "Manage client base", icon: User },
      { id: "payroll", title: "Payroll & Timesheets", subtitle: "Staff records", icon: CreditCard },
      { id: "files", title: "File Repository", subtitle: "Documents & uploads", icon: FileText },
      { id: "invoices", title: "Invoices & Billing", subtitle: "Revenue & billing", icon: FileText },
      { id: "settings", title: "Settings", subtitle: "Preferences & integrations", icon: Settings },
    ];

    navs
      .filter((n) => n.title.toLowerCase().includes(q) || n.subtitle.toLowerCase().includes(q))
      .forEach((n) => {
        items.push({
          type: "nav",
          id: n.id,
          title: n.title,
          subtitle: n.subtitle,
          icon: n.icon,
          action: () => {
            onSelectTab(n.id);
            onClose();
          },
        });
      });

    return items;
  }, [query, jobs, clients, onSelectTab, onSelectJob, onSelectClient, onClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      results[selectedIndex].action();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-100 bg-slate-50/50">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, job title, client name, or stage..."
            className="w-full px-3 text-sm bg-transparent border-none outline-none text-slate-800 placeholder-slate-400 font-medium"
            autoFocus
          />
          <kbd className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-500 bg-slate-200/80 rounded border border-slate-300">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 divide-y divide-slate-50">
          {results.length > 0 ? (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = item.icon;
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                    isSelected ? "bg-indigo-50 text-indigo-900 font-semibold" : "hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold leading-tight">{item.title}</p>
                      <p className="text-[11px] text-slate-400 font-normal mt-0.5 leading-none">{item.subtitle}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 px-2 py-0.5 bg-slate-100 rounded">
                      {item.type}
                    </span>
                    {isSelected && <ArrowRight className="w-3.5 h-3.5 text-indigo-600" />}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-10 text-center text-slate-400 text-xs">
              No matching jobs, clients, or workspace actions found for "{query}".
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>Navigate with ↑ and ↓, press Enter to open</span>
          <span>Shortcut: ⌘K</span>
        </div>
      </div>
    </div>
  );
}
