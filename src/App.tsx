import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, Shield, Zap, ChevronDown, UserPlus, Clock, X, Loader2, Menu } from "lucide-react";
import { JobBoard } from "./components/JobBoard";
import { Sidebar } from "./components/Sidebar";
import { JobRequestForm } from "./components/JobRequestForm";
import { Dashboard } from "./components/Dashboard";
import { Payroll } from "./components/Payroll";
import { UserManagement } from "./components/UserManagement";
import { FileRepository } from "./components/FileRepository";
import { Invoices } from "./components/Invoices";
import { Clients } from "./components/Clients";
import { Settings } from "./components/Settings";
import { AuthGate } from "./components/AuthGate";
import { ResetPasswordPage } from "./components/ResetPasswordPage";
import { ClientPortal } from "./components/ClientPortal";
import { CommandPalette } from "./components/CommandPalette";
import { JobDetailModal } from "./components/JobDetailModal";
import { Job, Employee, PayrollRecord, AppUser, Client, BusinessSettings, AuthenticatedUser, Business, Industry, PagePermission } from "./types";
import { api, getToken, setToken } from "./api";
import { useSyncedCollection } from "./useSyncedCollection";
import { readTiquetTab, readTiquetJobId, tiquetNavigationPath } from "./navigationState.js";

const DEFAULT_SETTINGS: BusinessSettings = {
  name: "",
  address: "",
  email: "",
  phone: "",
  logoUrl: "",
  website: "",
  paymentTerms: "",
  currency: "USD",
  taxRate: 0,
};

// No router in this app — matched by hand since it's the only deep link
// this app needs. /reset-password or /reset-password/<token>.
function matchResetPasswordPath(pathname: string): { matched: boolean; token: string | null } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "reset-password") return { matched: false, token: null };
  return { matched: true, token: parts[1] || null };
}

function matchPortalPath(pathname: string): { matched: boolean; token: string | null } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "portal") return { matched: false, token: null };
  return { matched: true, token: parts[1] || null };
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [activeBusiness, setActiveBusiness] = useState<Business | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const [resetPasswordRoute, setResetPasswordRoute] = useState(() => matchResetPasswordPath(window.location.pathname));
  const [portalRoute] = useState(() => matchPortalPath(window.location.pathname));

  const [activeTab, setActiveTab] = useState(() => readTiquetTab(window.location.search));
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [isLogTimeModalOpen, setIsLogTimeModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [selectedJobForModal, setSelectedJobForModal] = useState<Job | null>(null);

  const authenticated = !!currentUser && !!activeBusiness;

  // Keep authorized workspace navigation in the URL so refresh restores the page.
  useEffect(() => {
    if (!authenticated || portalRoute.matched || resetPasswordRoute.matched) return;
    const selectedJobId = activeTab === "jobs" ? readTiquetJobId(window.location.search) : null;
    const path = tiquetNavigationPath(window.location.href, activeTab, selectedJobId);
    if (path !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, "", path);
    }
  }, [activeTab, authenticated, portalRoute.matched, resetPasswordRoute.matched]);
  const canAccess = useCallback((permission: PagePermission) => {
    if (!currentUser) return false;
    return currentUser.role === "Admin" || Boolean(currentUser.permissions?.includes(permission));
  }, [currentUser]);
  const canOpenTab = useCallback((tab: string) => {
    if (!currentUser) return false;
    if (currentUser.role === "Admin") return true;
    const permissionByTab: Partial<Record<string, PagePermission>> = {
      dashboard: "dashboard",
      jobs: "jobs",
      clients: "clients",
      payroll: "payroll",
      files: "files",
      invoices: "invoices",
      "new-request": "new-request",
    };
    const permission = permissionByTab[tab];
    return Boolean(permission && canAccess(permission));
  }, [currentUser, canAccess]);

  useEffect(() => {
    if (currentUser && !canOpenTab(activeTab)) setActiveTab("dashboard");
  }, [activeTab, currentUser, canOpenTab]);

  // On load, if a session token already exists (page refresh, not a fresh
  // login), restore the session instead of bouncing back to the login screen.
  useEffect(() => {
    const restore = async () => {
      try {
        const me = await api.get<{ id: string; name: string; email: string; role: string; account_id: string; permissions?: PagePermission[]; oauth_provider?: string }>("/auth/me");
        const settings = await api.get<any>("/settings");
        setCurrentUser({
          id: me.id,
          name: me.name,
          email: me.email,
          role: me.role,
          permissions: me.permissions || [],
          provider: (me.oauth_provider as AuthenticatedUser["provider"]) || "email",
        });
        setActiveBusiness({
          id: me.account_id,
          name: settings?.name || "My Business",
          ownerEmail: me.email,
          settings: {
            name: settings?.name || "",
            address: settings?.address || "",
            email: settings?.email || me.email,
            phone: settings?.phone || "",
            logoUrl: settings?.logoUrl || "",
            website: settings?.website || "",
            paymentTerms: settings?.paymentTerms || DEFAULT_SETTINGS.paymentTerms,
            currency: settings?.currency || "USD",
            taxRate: settings?.taxRate || 0,
          },
        });
      } catch {
        setToken(null);
      } finally {
        setRestoringSession(false);
      }
    };
    restore();
  }, []);

  // ── Data collections, synced with the backend ──────────────────────────
  const canReadJobs = authenticated && (
    canAccess("dashboard") || canAccess("jobs") || canAccess("invoices") || canAccess("new-request")
  );
  const canReadClients = authenticated && (
    canAccess("clients") || canAccess("jobs") || canAccess("new-request")
  );
  const { items: jobs, setItems: setJobs } = useSyncedCollection<Job>("/jobs", canReadJobs);
  const { items: clients, setItems: setClients } = useSyncedCollection<Client>("/clients", canReadClients);

  // Surfaces whether the welcome email on a newly-created client actually
  // went out. Previously this was invisible — client creation "succeeded"
  // in the UI even when the email silently failed or was skipped (e.g. SMTP
  // not configured on the server), so there was no way to tell without
  // digging through server logs.
  const [emailNotice, setEmailNotice] = useState<{ message: string; tone: "warning" | "success" } | null>(null);
  const notifiedClientIdsRef = useRef(new Set<string>());

  useEffect(() => {
    for (const c of clients) {
      if (c.welcomeEmail && !notifiedClientIdsRef.current.has(c.id)) {
        notifiedClientIdsRef.current.add(c.id);
        if (c.welcomeEmail.skipped) {
          setEmailNotice({
            message: `Client "${c.name}" created — welcome email NOT sent (SMTP isn't configured on the server). Set SMTP_HOST/SMTP_USER/SMTP_PASS, or check Settings → Templates → "Send Test to Me".`,
            tone: "warning",
          });
        } else if (!c.welcomeEmail.sent) {
          setEmailNotice({
            message: `Client "${c.name}" created — welcome email failed to send${c.welcomeEmail.error ? `: ${c.welcomeEmail.error}` : ""}.`,
            tone: "warning",
          });
        } else {
          setEmailNotice({ message: `Client "${c.name}" created — welcome email sent.`, tone: "success" });
        }
        const timer = setTimeout(() => setEmailNotice(null), 8000);
        return () => clearTimeout(timer);
      }
    }
  }, [clients]);
  const { items: employees, setItems: setEmployees } = useSyncedCollection<Employee>("/employees", authenticated && canAccess("payroll"));
  const { items: payrollRecords, setItems: setPayrollRecords } = useSyncedCollection<PayrollRecord>("/payroll", authenticated && canAccess("payroll"));
  const { items: users, setItems: setUsers } = useSyncedCollection<AppUser>("/users", authenticated && currentUser?.role === "Admin");
  const { items: industries, setItems: setIndustries } = useSyncedCollection<Industry>("/industries", authenticated && canAccess("clients"));

  const [files, setFilesState] = useState<import("./types").FileItem[]>([]);
  const reloadFiles = useCallback(async () => {
    if (!authenticated || !canAccess("files")) return;
    try {
      const data = await api.get<import("./types").FileItem[]>("/files");
      setFilesState(data);
    } catch {
      // non-fatal — file repository will just show empty state
    }
  }, [authenticated, canAccess]);
  useEffect(() => { reloadFiles(); }, [reloadFiles]);

  const [settings, setSettingsState] = useState<BusinessSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    if (activeBusiness) setSettingsState(activeBusiness.settings);
  }, [activeBusiness]);

  const handleUpdateSettings = async (newSettings: BusinessSettings) => {
    const updated = await api.put<BusinessSettings>("/settings", newSettings);
    setSettingsState(updated);
    if (activeBusiness) {
      setActiveBusiness({ ...activeBusiness, name: updated.name, settings: updated });
    }
  };

  const handleAuthComplete = (user: AuthenticatedUser, business: Business) => {
    setCurrentUser(user);
    setActiveBusiness(business);
    setActiveTab("dashboard");
  };

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    setActiveBusiness(null);
    void fetch("/api/auth/logout", { method:"POST", credentials:"same-origin" })
      .finally(() => window.location.assign("/api/platform/start"));
  };

  if (portalRoute.matched && portalRoute.token) {
    return <ClientPortal token={portalRoute.token} />;
  }

  if (resetPasswordRoute.matched) {
    return (
      <ResetPasswordPage
        token={resetPasswordRoute.token}
        onBackToLogin={() => {
          window.history.pushState({}, "", "/");
          setResetPasswordRoute({ matched: false, token: null });
        }}
      />
    );
  }

  if (restoringSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-cyan-700 animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    window.location.replace("/api/platform/start");
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto w-6 h-6 text-cyan-700 animate-spin" />
          <p className="mt-3 text-sm text-slate-500">Checking your V79 Hub access…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="v79-tiquet-app flex h-[100dvh] min-h-[100dvh] bg-[#07111f] text-slate-100 font-sans overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        businessName={settings.name || activeBusiness!.name}
        onSwitchBusiness={handleLogout}
        onLogout={handleLogout}
        jobCount={jobs.filter((j) => j.status !== "completed" && j.status !== "paid").length}
        openInvoiceCount={jobs.filter((j) => j.status === "invoiced").length}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        role={currentUser!.role}
        permissions={currentUser!.permissions || []}
      />

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#07111f]">
        <header className="h-[64px] sm:h-[72px] bg-[#07111f]/95 backdrop-blur-xl border-b border-[#17324d]/80 flex items-center justify-between px-3 sm:px-6 z-30">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Open navigation menu"
              className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-xl lg:hidden cursor-pointer"
              title="Open Navigation Menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              aria-label="Search jobs, clients and actions"
              className="sm:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#1a3854] bg-[#091728] text-slate-400 hover:text-[#55c7ff]"
            >
              <Search className="w-5 h-5" />
            </button>

            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="hidden sm:flex items-center bg-[#091728] hover:bg-[#0d1e32] rounded-xl px-3 py-2 w-80 border border-[#1a3854] transition-colors cursor-pointer text-left group"
            >
              <Search className="w-4 h-4 text-slate-600 group-hover:text-[#55c7ff] transition-colors shrink-0" />
              <span className="ml-2 text-sm text-slate-500 truncate flex-1">Search jobs, clients, actions...</span>
              <kbd className="text-[9px] font-mono font-bold text-slate-600 bg-[#07111f] border border-[#1a3854] px-1.5 py-0.5 rounded">
                ⌘K
              </kbd>
            </button>

            <div className="hidden xl:flex items-center gap-1.5 bg-[#0A86FF]/10 border border-[#0A86FF]/25 px-3 py-1.5 rounded-full text-[9px] font-bold text-[#74d0ff] uppercase tracking-wide">
              <Shield className="w-3.5 h-3.5" />
              Workspace: {activeBusiness!.id.slice(0, 8)}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden sm:flex items-center gap-1.5 text-[9px] text-emerald-400 font-bold uppercase tracking-wider bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </div>

            <div className="relative">
              <button
                id="btn-quick-actions"
                onClick={() => setIsQuickActionsOpen(!isQuickActionsOpen)}
                className="flex min-h-10 min-w-10 items-center justify-center gap-2 bg-gradient-to-r from-[#FF7A00] to-[#ff9638] hover:from-[#ff8b21] hover:to-[#ffa14d] text-white px-2.5 sm:px-3.5 py-1.5 rounded-xl text-[10px] font-black transition-all shadow-[0_8px_28px_rgba(255,122,0,.16)] active:scale-[0.98] cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-white" />
                <span className="hidden sm:inline">Quick Actions</span>
                <ChevronDown className={`hidden sm:block w-3.5 h-3.5 transition-transform duration-200 ${isQuickActionsOpen ? "rotate-180" : ""}`} />
              </button>

              {isQuickActionsOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-[#091728] border border-[#1a3854] rounded-2xl shadow-2xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-2 border-b border-[#18324b]">
                    <p className="text-[9px] font-black text-slate-600 uppercase tracking-wider">Workspace Shortcuts</p>
                  </div>

                  <button
                    onClick={() => { setIsNewClientModalOpen(true); setIsQuickActionsOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] text-left text-[10px] font-bold text-slate-300 transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4 text-[#55c7ff]" />
                    New Client
                  </button>

                  <button
                    onClick={() => { setIsLogTimeModalOpen(true); setIsQuickActionsOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] text-left text-[10px] font-bold text-slate-300 transition-colors cursor-pointer"
                  >
                    <Clock className="w-4 h-4 text-emerald-500" />
                    Log Time / Time Card
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 border-l border-[#17324d] pl-2 sm:pl-3">
              {currentUser!.photoUrl ? (
                <img
                  src={currentUser!.photoUrl}
                  alt={currentUser!.name}
                  className="w-8 h-8 rounded-full border border-[#2b5275] object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 bg-gradient-to-br from-[#0A86FF] to-[#6d5dfc] text-white rounded-full flex items-center justify-center font-black text-[10px] uppercase">
                  {currentUser!.name.slice(0, 2)}
                </div>
              )}
              <div className="hidden md:block text-left">
                <p className="text-[10px] font-bold text-white leading-none">{currentUser!.name}</p>
                <p className="text-[8px] text-slate-600 font-semibold leading-none mt-1 truncate max-w-[120px]">{currentUser!.email}</p>
              </div>
            </div>
          </div>
        </header>

        {emailNotice && (
          <div
            className={`px-4 sm:px-8 py-2.5 text-xs sm:text-sm font-medium flex items-start sm:items-center justify-between gap-3 ${
              emailNotice.tone === "warning" ? "bg-amber-50 text-amber-800 border-b border-amber-200" : "bg-emerald-50 text-emerald-800 border-b border-emerald-200"
            }`}
          >
            <span>{emailNotice.message}</span>
            <button onClick={() => setEmailNotice(null)} className="text-current opacity-60 hover:opacity-100 ml-4">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 sm:p-5 xl:p-6 bg-[#07111f]">
          {activeTab === "dashboard" && <Dashboard jobs={jobs} currency={settings.currency} />}
          {activeTab === "jobs" && (
            <JobBoard jobs={jobs} setJobs={setJobs} employees={employees} clients={clients} settings={settings} />
          )}
          {activeTab === "clients" && <Clients clients={clients} setClients={setClients} jobs={jobs} industries={industries} currency={settings.currency} />}
          {activeTab === "payroll" && (
            <Payroll
              employees={employees}
              setEmployees={setEmployees}
              payrollRecords={payrollRecords}
              setPayrollRecords={setPayrollRecords}
              currency={settings.currency}
            />
          )}
          {activeTab === "users" && <UserManagement users={users} setUsers={setUsers} />}
          {activeTab === "files" && <FileRepository files={files} onFilesChanged={reloadFiles} />}
          {activeTab === "invoices" && (
            <Invoices jobs={jobs} setJobs={setJobs} employees={employees} clients={clients} settings={settings} />
          )}
          {activeTab === "settings" && (
            <Settings settings={settings} setSettings={handleUpdateSettings} industries={industries} setIndustries={setIndustries} workspaceId={activeBusiness!.id} />
          )}
          {activeTab === "new-request" && (
            <div className="max-w-4xl mx-auto">
              <JobRequestForm
                employees={employees}
                clients={clients}
                onSave={(jobData) => {
                  const newJob: Job = {
                    ...jobData,
                    id: crypto.randomUUID(),
                    createdAt: new Date().toISOString(),
                    activityLog: [
                      {
                        id: crypto.randomUUID(),
                        action: `Job request initiated for ${jobData.client}`,
                        timestamp: new Date().toISOString(),
                        user: currentUser!.name,
                      },
                    ],
                  };
                  setJobs([newJob, ...jobs]);
                  setActiveTab("jobs");
                }}
              />
            </div>
          )}
        </div>
      </main>

      {isNewClientModalOpen && (
        <NewClientModal
          industries={industries}
          onClose={() => setIsNewClientModalOpen(false)}
          onCreate={(newClient) => {
            setClients([newClient, ...clients]);
            setIsNewClientModalOpen(false);
          }}
        />
      )}

      {isLogTimeModalOpen && (
        <LogTimeModal
          employees={employees}
          onClose={() => setIsLogTimeModalOpen(false)}
          onSave={(employeeId, hours, date, clockIn, clockOut) => {
            const matchedEmployee = employees.find((emp) => emp.id === employeeId);
            if (!matchedEmployee) return;

            const newTimeCard = {
              id: crypto.randomUUID(),
              date,
              clockIn,
              clockOut,
              hoursWorked: hours,
            };

            setEmployees(
              employees.map((emp) =>
                emp.id === employeeId
                  ? {
                      ...emp,
                      hoursWorked: (emp.hoursWorked || 0) + hours,
                      timeCards: [newTimeCard, ...(emp.timeCards || [])],
                    }
                  : emp
              )
            );
            setIsLogTimeModalOpen(false);
          }}
        />
      )}

      {/* Global Keyboard-Driven Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        jobs={jobs}
        clients={clients}
        onSelectTab={(tab) => setActiveTab(tab)}
        onSelectJob={(job) => {
          setSelectedJobForModal(job);
        }}
        onSelectClient={() => {
          setActiveTab("clients");
        }}
      />

      {/* Direct Job Detail Modal when activated via Command Palette */}
      {selectedJobForModal && (
        <JobDetailModal
          job={selectedJobForModal}
          employees={employees}
          clients={clients}
          settings={settings}
          onClose={() => setSelectedJobForModal(null)}
          onUpdate={(updatedJob) => {
            setJobs(jobs.map((j) => (j.id === updatedJob.id ? updatedJob : j)));
            setSelectedJobForModal(updatedJob);
          }}
        />
      )}
    </div>
  );
}

function NewClientModal({ industries, onClose, onCreate }: { industries: Industry[]; onClose: () => void; onCreate: (c: Client) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto relative animate-in fade-in zoom-in-95 duration-150">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Add New Client</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-50 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        {error && <div className="mx-6 mt-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const target = e.currentTarget;
            const name = (target.elements.namedItem("clientName") as HTMLInputElement).value;
            const company = (target.elements.namedItem("clientCompany") as HTMLInputElement).value;
            const email = (target.elements.namedItem("clientEmail") as HTMLInputElement).value;
            const phone = (target.elements.namedItem("clientPhone") as HTMLInputElement).value;
            const address = (target.elements.namedItem("clientAddress") as HTMLInputElement).value;
            const industryId = (target.elements.namedItem("clientIndustry") as HTMLSelectElement).value;

            if (!name || !email) {
              setError("Contact name and email are required.");
              return;
            }

            onCreate({
              id: crypto.randomUUID(),
              name,
              company: company || "Individual",
              email,
              phone,
              address,
              industryId: industryId || null,
              createdAt: new Date().toISOString(),
            });
          }}
          className="p-6 space-y-4"
        >
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Contact Name *</label>
            <input name="clientName" type="text" required placeholder="John Smith" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Company / Organization</label>
            <input name="clientCompany" type="text" placeholder="e.g. Acme Corp" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Email *</label>
              <input name="clientEmail" type="email" required placeholder="john@example.com" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Phone</label>
              <input name="clientPhone" type="text" placeholder="+1 (555) 000-0000" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Industry</label>
            <select name="clientIndustry" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800">
              <option value="">— None —</option>
              {industries.map((ind) => (
                <option key={ind.id} value={ind.id}>{ind.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Billing Address</label>
            <textarea name="clientAddress" placeholder="123 Corporate Way, City, ST" rows={2} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800 resize-none" />
          </div>
          <div className="pt-2 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-colors shadow-md cursor-pointer">
              Add Client
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LogTimeModal({
  employees,
  onClose,
  onSave,
}: {
  employees: Employee[];
  onClose: () => void;
  onSave: (employeeId: string, hours: number, date: string, clockIn: string, clockOut: string) => void;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto relative animate-in fade-in zoom-in-95 duration-150">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Log Hours / Time Card</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-50 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        {employees.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <p className="text-sm">No employees on file yet.</p>
            <p className="text-xs text-slate-400 mt-2">Add an employee in the Payroll panel first.</p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const target = e.currentTarget;
              const employeeId = (target.elements.namedItem("employeeId") as HTMLSelectElement).value;
              const date = (target.elements.namedItem("logDate") as HTMLInputElement).value;
              const hours = parseFloat((target.elements.namedItem("logHours") as HTMLInputElement).value);
              const clockIn = (target.elements.namedItem("clockIn") as HTMLInputElement).value || "09:00";
              const clockOut = (target.elements.namedItem("clockOut") as HTMLInputElement).value || "17:00";
              onSave(employeeId, hours, date, clockIn, clockOut);
            }}
            className="p-6 space-y-4"
          >
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Select Employee *</label>
              <select name="employeeId" required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800">
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.role} - {emp.workerType})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Date *</label>
                <input name="logDate" type="date" required defaultValue={new Date().toISOString().split("T")[0]} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Hours Worked *</label>
                <input name="logHours" type="number" required min="0.1" max="24" step="0.1" defaultValue="8" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Clock In (Optional)</label>
                <input name="clockIn" type="time" defaultValue="09:00" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Clock Out (Optional)</label>
                <input name="clockOut" type="time" defaultValue="17:00" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
              </div>
            </div>
            <div className="pt-2 flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm transition-colors cursor-pointer">
                Cancel
              </button>
              <button type="submit" className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-colors shadow-md cursor-pointer">
                Save Time Card
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}