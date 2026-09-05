import React from "react";
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Settings,
  PlusCircle,
  CreditCard,
  Users,
  FolderOpen,
  Contact,
  LogOut,
  ArrowLeftRight,
  X,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  businessName: string;
  onSwitchBusiness: () => void;
  onLogout: () => void;
  jobCount?: number;
  openInvoiceCount?: number;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({
  activeTab,
  setActiveTab,
  businessName,
  onSwitchBusiness,
  onLogout,
  jobCount,
  openInvoiceCount,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const handleNavClick = (tab: string) => {
    setActiveTab(tab);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-100 flex flex-col h-full shrink-0 border-r border-slate-800/80 transition-transform duration-200 lg:static lg:translate-x-0 ${
          isOpenMobile ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-950/50">
              <Briefcase className="w-4 h-4 text-white" />
            </div>
            <div className="overflow-hidden">
              <span className="text-sm font-bold text-slate-100 block truncate max-w-[130px] leading-tight">
                {businessName}
              </span>
              <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase flex items-center gap-1 mt-0.5">
                <ShieldCheck className="w-2.5 h-2.5" /> TIQUET V79
              </span>
            </div>
          </div>

          {/* Close button on mobile */}
          <button
            onClick={onCloseMobile}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 p-3 space-y-6 overflow-y-auto">
          {/* Group 1: Operations */}
          <div className="space-y-1">
            <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
              Operations
            </p>
            <NavItem
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Dashboard"
              active={activeTab === "dashboard"}
              onClick={() => handleNavClick("dashboard")}
            />
            <NavItem
              icon={<Briefcase className="w-4 h-4" />}
              label="Jobs Pipeline"
              badge={jobCount !== undefined && jobCount > 0 ? jobCount : undefined}
              active={activeTab === "jobs"}
              onClick={() => handleNavClick("jobs")}
            />
            <NavItem
              icon={<Contact className="w-4 h-4" />}
              label="Clients"
              active={activeTab === "clients"}
              onClick={() => handleNavClick("clients")}
            />
            <NavItem
              icon={<FileText className="w-4 h-4" />}
              label="Invoices & Billing"
              badge={openInvoiceCount !== undefined && openInvoiceCount > 0 ? openInvoiceCount : undefined}
              active={activeTab === "invoices"}
              onClick={() => handleNavClick("invoices")}
            />
            <NavItem
              icon={<PlusCircle className="w-4 h-4 text-emerald-400" />}
              label="New Request"
              active={activeTab === "new-request"}
              onClick={() => handleNavClick("new-request")}
            />
          </div>

          {/* Group 2: Resources & Operations */}
          <div className="space-y-1">
            <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
              Resources
            </p>
            <NavItem
              icon={<FolderOpen className="w-4 h-4" />}
              label="Files Repository"
              active={activeTab === "files"}
              onClick={() => handleNavClick("files")}
            />
            <NavItem
              icon={<CreditCard className="w-4 h-4" />}
              label="Payroll"
              active={activeTab === "payroll"}
              onClick={() => handleNavClick("payroll")}
            />
          </div>

          {/* Group 3: Administration */}
          <div className="space-y-1">
            <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
              Administration
            </p>
            <NavItem
              icon={<Users className="w-4 h-4" />}
              label="Users & Roles"
              active={activeTab === "users"}
              onClick={() => handleNavClick("users")}
            />
            <NavItem
              icon={<Settings className="w-4 h-4" />}
              label="Settings"
              active={activeTab === "settings"}
              onClick={() => handleNavClick("settings")}
            />
          </div>
        </nav>

        {/* Footer Tenant Switcher & Session Controls */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 space-y-2.5">
          <div className="px-2 py-1 flex items-center justify-between">
            <div className="overflow-hidden">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Active Workspace</p>
              <p className="text-xs font-semibold text-slate-300 truncate max-w-[120px]">{businessName}</p>
            </div>
            <button
              onClick={onSwitchBusiness}
              className="text-indigo-400 hover:text-indigo-300 text-[10px] font-bold flex items-center gap-1 uppercase transition-colors px-2 py-1 hover:bg-slate-800 rounded"
              title="Switch Business Tenant"
            >
              <ArrowLeftRight className="w-3 h-3" />
              Switch
            </button>
          </div>

          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-800/80 hover:bg-red-950/70 hover:text-red-300 rounded-xl text-xs font-semibold text-slate-300 transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Log Out
          </button>
        </div>
      </aside>
    </>
  );
}

function NavItem({
  icon,
  label,
  badge,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
        active
          ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/40"
          : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
      }`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
      {badge !== undefined && (
        <span
          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
            active ? "bg-white/20 text-white" : "bg-slate-800 text-slate-300"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
