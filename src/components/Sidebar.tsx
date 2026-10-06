import React from "react";
import { PagePermission } from "../types";
import {
  ArrowLeft,
  Briefcase,
  Contact,
  CreditCard,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
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
  role: string;
  permissions: PagePermission[];
}

export function Sidebar({
  activeTab,
  setActiveTab,
  businessName,
  onSwitchBusiness: _onSwitchBusiness,
  onLogout,
  jobCount,
  openInvoiceCount,
  isOpenMobile,
  onCloseMobile,
  role,
  permissions,
}: SidebarProps) {
  const can = (permission: PagePermission) => role === "Admin" || permissions.includes(permission);
  const handleNavClick = (tab: string) => {
    setActiveTab(tab);
    onCloseMobile?.();
  };

  const itemClass = (active: boolean) =>
    `group w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all border ${
      active
        ? "bg-gradient-to-r from-[#FF7A00]/25 to-[#ff9a3d]/10 text-white border-[#FF7A00]/45 shadow-[0_0_22px_rgba(255,122,0,.10)]"
        : "text-slate-400 border-transparent hover:text-white hover:bg-white/[0.045]"
    }`;

  return (
    <>
      {isOpenMobile && (
        <div onClick={onCloseMobile} className="fixed inset-0 bg-[#020711]/80 backdrop-blur-sm z-40 lg:hidden" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[252px] bg-[#06101d] text-slate-100 flex flex-col h-full shrink-0 border-r border-[#17324d]/70 transition-transform duration-200 lg:static lg:translate-x-0 ${
          isOpenMobile ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="absolute inset-x-0 top-0 h-60 bg-[radial-gradient(circle_at_22%_0%,rgba(10,134,255,.18),transparent_58%),radial-gradient(circle_at_78%_12%,rgba(255,122,0,.10),transparent_44%)] pointer-events-none" />

        <div className="relative px-5 pt-5 pb-5 border-b border-[#17324d]/60 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#0A86FF] via-[#0871d4] to-[#FF7A00] p-[1px] shadow-[0_0_24px_rgba(10,134,255,.15)] shrink-0">
              <div className="w-full h-full rounded-[15px] bg-[#081727] flex items-center justify-center">
                <Briefcase className="w-5 h-5 text-[#ff9a3d]" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[16px] font-black tracking-[-0.04em] text-white">TIQUET</span>
                <span className="text-[8px] font-black tracking-[0.18em] text-[#55c7ff]">V79</span>
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5 truncate max-w-[135px]">{businessName}</div>
            </div>
          </div>
          <button onClick={onCloseMobile} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-white/5 lg:hidden">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="relative flex-1 p-3.5 space-y-6 overflow-y-auto">
          <div>
            <p className="px-3 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-600">Operations</p>
            <div className="space-y-1">
              {can("dashboard") && <NavItem icon={<LayoutDashboard className="w-4 h-4" />} label="Overview" active={activeTab === "dashboard"} onClick={() => handleNavClick("dashboard")} className={itemClass(activeTab === "dashboard")} />}
              {can("jobs") && <NavItem icon={<Briefcase className="w-4 h-4" />} label="Jobs Pipeline" badge={jobCount} active={activeTab === "jobs"} onClick={() => handleNavClick("jobs")} className={itemClass(activeTab === "jobs")} />}
              {can("clients") && <NavItem icon={<Contact className="w-4 h-4" />} label="Clients" active={activeTab === "clients"} onClick={() => handleNavClick("clients")} className={itemClass(activeTab === "clients")} />}
              {can("invoices") && <NavItem icon={<FileText className="w-4 h-4" />} label="Invoices" badge={openInvoiceCount} active={activeTab === "invoices"} onClick={() => handleNavClick("invoices")} className={itemClass(activeTab === "invoices")} />}
              {can("new-request") && <NavItem icon={<PlusCircle className="w-4 h-4 text-[#ff9a3d]" />} label="New Request" active={activeTab === "new-request"} onClick={() => handleNavClick("new-request")} className={itemClass(activeTab === "new-request")} />}
            </div>
          </div>

          <div>
            <p className="px-3 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-600">Resources</p>
            <div className="space-y-1">
              {can("files") && <NavItem icon={<FolderOpen className="w-4 h-4" />} label="Files" active={activeTab === "files"} onClick={() => handleNavClick("files")} className={itemClass(activeTab === "files")} />}
              {can("payroll") && <NavItem icon={<CreditCard className="w-4 h-4" />} label="Payroll Tracker" active={activeTab === "payroll"} onClick={() => handleNavClick("payroll")} className={itemClass(activeTab === "payroll")} />}
            </div>
          </div>

          {role === "Admin" && (
            <div>
              <p className="px-3 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-600">Administration</p>
              <div className="space-y-1">
                <NavItem icon={<Users className="w-4 h-4" />} label="Users & Roles" active={activeTab === "users"} onClick={() => handleNavClick("users")} className={itemClass(activeTab === "users")} />
                <NavItem icon={<Settings className="w-4 h-4" />} label="Settings" active={activeTab === "settings"} onClick={() => handleNavClick("settings")} className={itemClass(activeTab === "settings")} />
              </div>
            </div>
          )}
        </nav>

        <div className="relative p-3.5 border-t border-[#17324d]/70 bg-[#050d17] space-y-2.5">
          <div className="rounded-2xl border border-[#1b3956] bg-[#091727] p-3">
            <div className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-600">Active workspace</div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-white truncate">{businessName}</div>
                <div className="text-[9px] text-emerald-400 flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Connected
                </div>
              </div>
              <ShieldCheck className="w-4 h-4 text-[#55c7ff] shrink-0" />
            </div>
          </div>

          <a href="https://hub.v79sl.com" className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-[#0A86FF]/30 bg-[#0A86FF]/10 hover:bg-[#0A86FF]/18 text-[10px] font-bold text-[#74d0ff] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to V79 Digital Hub
          </a>

          <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[10px] font-bold text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Log out
          </button>

          <div className="pt-1 text-center text-[8px] text-slate-700 flex items-center justify-center gap-1">
            <Sparkles className="w-2.5 h-2.5" /> V79 Digital · From Idea to Advantage
          </div>
        </div>
      </aside>
    </>
  );
}

function NavItem({
  icon,
  label,
  badge,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button onClick={onClick} className={className}>
      <div className="flex items-center gap-3">
        <span className="text-slate-400 group-hover:text-white">{icon}</span>
        <span>{label}</span>
      </div>
      {badge !== undefined && badge > 0 && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#FF7A00]/15 border border-[#FF7A00]/25 text-[#ffad65] text-[9px] font-black flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}