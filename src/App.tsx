import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, Shield, Zap, ChevronDown, UserPlus, Clock, X, Loader2, Menu, Moon, Sun } from "lucide-react";
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
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return window.localStorage.getItem("v79-tiquet-theme") === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("v79-tiquet-theme", theme); } catch { /* Private browsing can restrict storage. */ }
  }, [theme]);
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
    if (!currentUser || canOpenTab(activeTab)) return;
    const next = ["dashboard", "jobs", "clients", "invoices", "new-request", "files", "payroll"]
      .find((tab) => canOpenTab(tab)) || "no-access";
    if (next !== activeTab) setActiveTab(next);
  }, [activeTab, currentUser, canOpenTab]);

  useEffect(() => {
    if (!authenticated || portalRoute.matched || resetPasswordRoute.matched) return;
    const names: Record<string, string> = {
      dashboard: "Overview", jobs: "Jobs", clients: "Clients", invoices: "Invoices",
      "new-request": "New Request", files: "Files", payroll: "Payroll",
      users: "Users & Roles", settings: "Settings",
    };
    document.title = `${names[activeTab] || "Workspace"} | Tiquet | Vision79`;
  }, [activeTab, authenticated, portalRoute.matched, resetPasswordRoute.matched]);

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
  const { items: jobs, setItems: setJobs, loading: jobsLoading, error: jobsError, reload: reloadJobs } = useSyncedCollection<Job>("/jobs", canReadJobs);
  const { items: clients, setItems: setClients, loading: clientsLoading, error: clientsError, reload: reloadClients } = useSyncedCollection<Client>("/clients", canReadClients);

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
  const { items: employees, setItems: setEmployees, loading: employeesLoading, error: employeesError, reload: reloadEmployees } = useSyncedCollection<Employee>("/employees", authenticated && canAccess("payroll"));
  const { items: payrollRecords, setItems: setPayrollRecords, loading: payrollLoading, error: payrollError, reload: reloadPayroll } = useSyncedCollection<PayrollRecord>("/payroll", authenticated && canAccess("payroll"));
  const { items: users, setItems: setUsers, loading: usersLoading, error: usersError, reload: reloadUsers } = useSyncedCollection<AppUser>("/users", authenticated && currentUser?.role === "Admin");
  const { items: industries, setItems: setIndustries, loading: industriesLoading, error: industriesError, reload: reloadIndustries } = useSyncedCollection<Industry>("/industries", authenticated && canAccess("clients"));

  const [files, setFilesState] = useState<import("./types").FileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState(false);
  const filesRequest = useRef(0);
  const reloadFiles = useCallback(async () => {
    const request = ++filesRequest.current;
    setFilesState([]);
    setFilesError(false);
    if (!authenticated || !canAccess("files")) {
      setFilesLoading(false);
      return;
    }
    setFilesLoading(true);
    try {
      const data = await api.get<import("./types").FileItem[]>("/files");
      if (request === filesRequest.current) setFilesState(data);
    } catch {
      if (request === filesRequest.current) setFilesError(true);
    } finally {
      if (request === filesRequest.current) setFilesLoading(false);
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
    // Capture the current bearer BEFORE clearing sessionStorage. Hub-managed
    // sessions normally use an HttpOnly cookie; send both when present so the
    // server can revoke each distinct signed token durably.
    const bearer = getToken();
    setToken(null);
    setCurrentUser(null);
    setActiveBusiness(null);
    void fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    }).then(response => {
      if (!response.ok) throw new Error("Logout revocation could not be confirmed");
      window.location.assign("/api/platform/start");
    }).catch(() => {
      // Never imply server-side revocation succeeded when the DB is unavailable.
      window.alert("Your Tiquet session could not be fully signed out. Close this tab and contact support before using a shared device.");
    });
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
    <div data-theme={theme} className="v79-tiquet-app flex h-[100dvh] min-h-[100dvh] bg-[#07111f] text-slate-100 font-sans overflow-hidden">
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
            <button type="button" onClick={() => setTheme((old) => old === "dark" ? "light" : "dark")} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} className="min-h-11 min-w-11 rounded-xl border border-[#1a3854] text-slate-200 hover:text-white hover:bg-white/10 flex items-center justify-center focus-visible:outline focus-visible:outline-2">{theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
            <div className="hidden sm:flex items-center text-xs text-slate-300 px-2" aria-label="Current workspace">Tiquet workspace</div>

            {(canOpenTab("clients") || canOpenTab("payroll")) && <div className="relative">
              <button
                id="btn-quick-actions"
                onClick={() => setIsQuickActionsOpen(!isQuickActionsOpen)}
                className="flex min-h-10 min-w-10 items-center justify-center gap-2 bg-gradient-to-r from-[#0758B8] to-[#009FAD] hover:from-[#164783] hover:to-[#007b85] text-white px-3 sm:px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-[0_8px_28px_rgba(255,122,0,.16)] active:scale-[0.98] cursor-pointer"
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

                  {canOpenTab("clients") && <button
                    onClick={() => { setIsNewClientModalOpen(true); setIsQuickActionsOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] text-left text-[10px] font-bold text-slate-300 transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4 text-[#55c7ff]" />
                    New Client
                  </button>}

                  {canOpenTab("payroll") && <button
                    onClick={() => { setIsLogTimeModalOpen(true); setIsQuickActionsOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] text-left text-[10px] font-bold text-slate-300 transition-colors cursor-pointer"
                  >
                    <Clock className="w-4 h-4 text-emerald-500" />
                    Log Time / Time Card
                  </button>}
                </div>
              )}
            </div>}

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
          {activeTab === "dashboard" && canOpenTab("dashboard") && <Dashboard jobs={jobs} jobsLoading={jobsLoading} jobsError={jobsError} onRetryJobs={() => { void reloadJobs(); }} currency={settings.currency} onOpenJob={canOpenTab("jobs") ? (id) => {
            window.history.replaceState(window.history.state, "", tiquetNavigationPath(window.location.href, "jobs", id));
            setActiveTab("jobs");
          } : undefined} />}
          {activeTab === "jobs" && canOpenTab("jobs") && (
            <JobBoard jobs={jobs} setJobs={setJobs} employees={employees} clients={clients} settings={settings} jobsLoading={jobsLoading} jobsError={jobsError} onRetryJobs={() => { void reloadJobs(); }} />
          )}
          {activeTab === "clients" && canOpenTab("clients") && (clientsLoading || clientsError || industriesLoading || industriesError
            ? <div role={clientsError || industriesError ? "alert" : "status"} className="rounded-xl border border-[#1a3854] p-5 text-sm">
                {clientsError || industriesError ? "Client information is unavailable." : "Loading clients…"}
                {(clientsError || industriesError) && <button type="button" onClick={() => { void reloadClients(); void reloadIndustries(); }} className="ml-3 min-h-11 font-semibold underline">Retry</button>}
              </div>
            : <Clients clients={clients} setClients={setClients} jobs={jobs} industries={industries} currency={settings.currency} />
          )}
          {activeTab === "payroll" && canOpenTab("payroll") && (
            employeesLoading || payrollLoading || employeesError || payrollError
            ? <div role={employeesError || payrollError ? "alert" : "status"} className="rounded-xl border border-[#1a3854] p-5 text-sm">
                {employeesError || payrollError ? "Payroll and timesheet data are unavailable." : "Loading payroll…"}
                {(employeesError || payrollError) && <button type="button" onClick={() => { void reloadEmployees(); void reloadPayroll(); }} className="ml-3 min-h-11 font-semibold underline">Retry</button>}
              </div>
            : <Payroll
              employees={employees}
              setEmployees={setEmployees}
              payrollRecords={payrollRecords}
              setPayrollRecords={setPayrollRecords}
              currency={settings.currency}
            />
          )}
          {activeTab === "users" && canOpenTab("users") && (usersLoading || usersError
            ? <div role={usersError ? "alert" : "status"} className="rounded-xl border border-[#1a3854] p-5 text-sm">
                {usersError ? "User and role data are unavailable." : "Loading users…"}
                {usersError && <button type="button" onClick={() => { void reloadUsers(); }} className="ml-3 min-h-11 font-semibold underline">Retry</button>}
              </div>
            : <UserManagement users={users} setUsers={setUsers} />
          )}
          {activeTab === "files" && canOpenTab("files") && (filesLoading || filesError
            ? <div role={filesError ? "alert" : "status"} className="rounded-xl border border-[#1a3854] p-5 text-sm">
                {filesError ? "The file repository is unavailable; no empty-state claim is shown." : "Loading files…"}
                {filesError && <button type="button" onClick={() => { void reloadFiles(); }} className="ml-3 min-h-11 font-semibold underline">Retry</button>}
              </div>
            : <FileRepository files={files} onFilesChanged={reloadFiles} />
          )}
          {activeTab === "invoices" && canOpenTab("invoices") && (
            <Invoices jobs={jobs} setJobs={setJobs} employees={employees} clients={clients} settings={settings} jobsLoading={jobsLoading} jobsError={jobsError} onRetryJobs={() => { void reloadJobs(); }} />
          )}
          {activeTab === "settings" && canOpenTab("settings") && (
            <Settings settings={settings} setSettings={handleUpdateSettings} industries={industries} setIndustries={setIndustries} workspaceId={activeBusiness!.id} />
          )}
          {activeTab === "new-request" && canOpenTab("new-request") && (
            jobsLoading || jobsError || clientsLoading || clientsError ? <div role={jobsError || clientsError ? "alert" : "status"} className="rounded-xl border border-amber-500/30 p-5 text-sm text-slate-200">
              {jobsError || clientsError ? "Requests cannot be submitted until jobs and clients load successfully." : "Loading jobs and clients before starting a request…"}
              {(jobsError || clientsError) && <button type="button" onClick={() => { void reloadJobs(); void reloadClients(); }} className="ml-3 min-h-11 font-semibold underline">Retry</button>}
            </div> : <div className="max-w-4xl mx-auto">
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
          {activeTab === "no-access" && <div role="status" className="rounded-xl border border-amber-500/30 p-5 text-sm text-slate-200">No workspace pages are assigned to your account. Contact your workspace administrator.</div>}
        </div>
      </main>

      {isNewClientModalOpen && canOpenTab("clients") && (
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
        canOpenTab={canOpenTab}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpen={() => setIsCommandPaletteOpen(true)}
        jobs={jobs}
        clients={clients}
        onSelectTab={(tab) => { if (canOpenTab(tab)) setActiveTab(tab); }}
        onSelectJob={(job) => {
          if (canOpenTab("jobs")) setSelectedJobForModal(job);
        }}
        onSelectClient={() => {
          if (canOpenTab("clients")) setActiveTab("clients");
        }}
      />

      {/* Direct Job Detail Modal when activated via Command Palette */}
      {selectedJobForModal && canOpenTab("jobs") && (
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
