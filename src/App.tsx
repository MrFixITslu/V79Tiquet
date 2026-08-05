import React, { useState, useEffect, useCallback } from "react";
import { Search, Shield, Zap, ChevronDown, UserPlus, Clock, X, Loader2 } from "lucide-react";
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
import { Job, Employee, PayrollRecord, AppUser, Client, BusinessSettings, AuthenticatedUser, Business, Industry } from "./types";
import { api, getToken, setToken } from "./api";
import { useSyncedCollection } from "./useSyncedCollection";

const DEFAULT_SETTINGS: BusinessSettings = {
  name: "",
  address: "",
  email: "",
  phone: "",
  logoUrl: "",
  paymentTerms: "",
  currency: "USD",
  taxRate: 0,
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [activeBusiness, setActiveBusiness] = useState<Business | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [isLogTimeModalOpen, setIsLogTimeModalOpen] = useState(false);

  const authenticated = !!currentUser && !!activeBusiness;

  // On load, if a session token already exists (page refresh, not a fresh
  // login), restore the session instead of bouncing back to the login screen.
  useEffect(() => {
    const restore = async () => {
      const token = getToken();
      if (!token) {
        setRestoringSession(false);
        return;
      }
      try {
        const me = await api.get<{ id: string; name: string; email: string; account_id: string }>("/auth/me");
        const settings = await api.get<any>("/settings");
        setCurrentUser({ id: me.id, name: me.name, email: me.email, provider: "email" });
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
  const { items: jobs, setItems: setJobs } = useSyncedCollection<Job>("/jobs", authenticated);
  const { items: clients, setItems: setClients } = useSyncedCollection<Client>("/clients", authenticated);
  const { items: employees, setItems: setEmployees } = useSyncedCollection<Employee>("/employees", authenticated);
  const { items: payrollRecords, setItems: setPayrollRecords } = useSyncedCollection<PayrollRecord>("/payroll", authenticated);
  const { items: users, setItems: setUsers } = useSyncedCollection<AppUser>("/users", authenticated);
  const { items: industries, setItems: setIndustries } = useSyncedCollection<Industry>("/industries", authenticated);

  const [files, setFilesState] = useState<import("./types").FileItem[]>([]);
  const reloadFiles = useCallback(async () => {
    if (!authenticated) return;
    try {
      const data = await api.get<import("./types").FileItem[]>("/files");
      setFilesState(data);
    } catch {
      // non-fatal — file repository will just show empty state
    }
  }, [authenticated]);
  useEffect(() => { reloadFiles(); }, [reloadFiles]);

  const [settings, setSettingsState] = useState<BusinessSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    if (activeBusiness) setSettingsState(activeBusiness.settings);
  }, [activeBusiness]);

  const handleUpdateSettings = async (newSettings: BusinessSettings) => {
    setSettingsState(newSettings);
    try {
      await api.put("/settings", newSettings);
      if (activeBusiness) {
        setActiveBusiness({ ...activeBusiness, name: newSettings.name, settings: newSettings });
      }
    } catch (e) {
      console.error("Failed to save settings", e);
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
  };

  if (restoringSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return <AuthGate onAuthComplete={handleAuthComplete} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        businessName={settings.name || activeBusiness!.name}
        onSwitchBusiness={handleLogout}
        onLogout={handleLogout}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center bg-slate-100 rounded-xl px-3 py-2 w-80 border border-slate-200">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search jobs, clients, or files..."
                className="bg-transparent border-none outline-none ml-2 text-sm w-full text-slate-700"
              />
            </div>

            <div className="hidden lg:flex items-center gap-1 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full text-[10px] font-bold text-indigo-700 uppercase tracking-wide">
              <Shield className="w-3.5 h-3.5" />
              Workspace: {activeBusiness!.id.slice(0, 8)}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-600 font-bold uppercase tracking-wider bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </div>

            <div className="relative">
              <button
                id="btn-quick-actions"
                onClick={() => setIsQuickActionsOpen(!isQuickActionsOpen)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-[0.98] cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300 animate-pulse" />
                <span>Quick Actions</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isQuickActionsOpen ? "rotate-180" : ""}`} />
              </button>

              {isQuickActionsOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-1.5 border-b border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Workspace Shortcuts</p>
                  </div>

                  <button
                    onClick={() => { setIsNewClientModalOpen(true); setIsQuickActionsOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4 text-indigo-500" />
                    New Client
                  </button>

                  <button
                    onClick={() => { setIsLogTimeModalOpen(true); setIsQuickActionsOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                  >
                    <Clock className="w-4 h-4 text-emerald-500" />
                    Log Time / Time Card
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
              {currentUser!.photoUrl ? (
                <img
                  src={currentUser!.photoUrl}
                  alt={currentUser!.name}
                  className="w-8 h-8 rounded-full border-2 border-indigo-100 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold text-xs uppercase">
                  {currentUser!.name.slice(0, 2)}
                </div>
              )}
              <div className="hidden md:block text-left">
                <p className="text-xs font-bold text-slate-900 leading-none">{currentUser!.name}</p>
                <p className="text-[10px] text-slate-400 font-semibold leading-none mt-1 truncate max-w-[120px]">{currentUser!.email}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          {activeTab === "dashboard" && <Dashboard jobs={jobs} />}
          {activeTab === "jobs" && (
            <JobBoard jobs={jobs} setJobs={setJobs} employees={employees} clients={clients} settings={settings} />
          )}
          {activeTab === "clients" && <Clients clients={clients} setClients={setClients} jobs={jobs} industries={industries} />}
          {activeTab === "payroll" && (
            <Payroll
              employees={employees}
              setEmployees={setEmployees}
              payrollRecords={payrollRecords}
              setPayrollRecords={setPayrollRecords}
            />
          )}
          {activeTab === "users" && <UserManagement users={users} setUsers={setUsers} />}
          {activeTab === "files" && <FileRepository files={files} onFilesChanged={reloadFiles} />}
          {activeTab === "invoices" && (
            <Invoices jobs={jobs} setJobs={setJobs} employees={employees} clients={clients} settings={settings} />
          )}
          {activeTab === "settings" && (
            <Settings settings={settings} setSettings={handleUpdateSettings} industries={industries} setIndustries={setIndustries} />
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
    </div>
  );
}

function NewClientModal({ industries, onClose, onCreate }: { industries: Industry[]; onClose: () => void; onCreate: (c: Client) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in-95 duration-150">
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
          <div className="grid grid-cols-2 gap-4">
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
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in-95 duration-150">
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Date *</label>
                <input name="logDate" type="date" required defaultValue={new Date().toISOString().split("T")[0]} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Hours Worked *</label>
                <input name="logHours" type="number" required min="0.1" max="24" step="0.1" defaultValue="8" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
