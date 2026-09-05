import React, { useState, useEffect, useRef } from "react";
import {
  Briefcase,
  CheckCircle2,
  Clock,
  DollarSign,
  Send,
  Download,
  AlertCircle,
  FileText,
  Building2,
  Phone,
  Mail,
  ExternalLink,
  ShieldCheck,
  ChevronRight,
  Sparkles,
  Loader2,
} from "lucide-react";

interface PortalData {
  job: {
    id: string;
    title: string;
    client: string;
    description?: string;
    status: string;
    priority?: string;
    amount?: number;
    quoteApproved?: number;
    depositPaid?: number;
    dueDate?: string;
    createdAt: string;
    secureToken: string;
    messages?: Array<{ id: string; sender: string; content: string; timestamp: string }>;
    lineItems?: Array<{ id?: string; description: string; quantity: number; rate: number; total?: number }>;
    deliverables?: Array<{ id: string; name: string; url?: string; completed?: boolean }>;
    activityLog?: Array<{ id: string; action: string; timestamp: string; user: string }>;
  };
  settings: {
    name?: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    logoUrl?: string;
    currency?: string;
    paymentTerms?: string;
  };
}

const STAGES = [
  { id: "request", label: "Request Received", step: 1 },
  { id: "estimation", label: "Quote & Estimation", step: 2 },
  { id: "in-progress", label: "Work in Progress", step: 3 },
  { id: "review", label: "Client Review", step: 4 },
  { id: "invoiced", label: "Invoiced", step: 5 },
  { id: "completed", label: "Completed", step: 6 },
  { id: "paid", label: "Paid & Delivered", step: 7 },
];

export function ClientPortal({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    try {
      const res = await fetch(`/api/portal/${token}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "Invalid or expired portal link." : "Failed to load project details.");
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Could not load portal.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Setup real-time WebSocket connection
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "chat_message" && payload.message) {
            setData((prev) => {
              if (!prev) return prev;
              const existing = prev.job.messages || [];
              if (existing.some((m) => m.id === payload.message.id)) return prev;
              return {
                ...prev,
                job: {
                  ...prev.job,
                  messages: [...existing, payload.message],
                },
              };
            });
          } else if (payload.type === "stage_changed") {
            setData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                job: {
                  ...prev.job,
                  status: payload.newStage,
                },
              };
            });
          }
        } catch {
          // Ignore invalid parse
        }
      };
    } catch {
      // WS error fallback
    }

    return () => {
      if (ws) ws.close();
    };
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.job?.messages]);

  const handleApproveQuote = async () => {
    setActionLoading("approve");
    try {
      const res = await fetch(`/api/portal/${token}/approve-quote`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to approve quote.");
      setSuccessToast("Quote approved! Project has been moved to In Progress.");
      await loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePayDeposit = async () => {
    setActionLoading("deposit");
    try {
      const res = await fetch(`/api/portal/${token}/pay-deposit`, { method: "POST" });
      if (!res.ok) throw new Error("Deposit payment failed.");
      setSuccessToast("30% Deposit confirmed! Thank you.");
      await loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePayFinal = async () => {
    setActionLoading("final");
    try {
      const res = await fetch(`/api/portal/${token}/pay-final`, { method: "POST" });
      if (!res.ok) throw new Error("Final payment failed.");
      setSuccessToast("Final payment confirmed! Job marked as Paid.");
      await loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || sendingMessage) return;

    setSendingMessage(true);
    try {
      const res = await fetch(`/api/portal/${token}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageText.trim() }),
      });
      if (!res.ok) throw new Error("Failed to send message.");
      setMessageText("");
      await loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-slate-100 p-4">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wide text-slate-300">Loading Client Portal...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-2xl flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold text-slate-100 mb-2">Portal Access Link Expired or Invalid</h1>
        <p className="text-sm text-slate-400 max-w-md mb-6">{error || "Please contact the project manager for a new portal invitation link."}</p>
        <a
          href="/"
          className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors"
        >
          Return to Workspace Home
        </a>
      </div>
    );
  }

  const { job, settings } = data;
  const currencySymbol = settings.currency === "EUR" ? "€" : settings.currency === "GBP" ? "£" : "$";
  const currentStageIndex = STAGES.findIndex((s) => s.id === job.status);
  const totalAmount = job.amount || 0;
  const depositAmount = Math.round(totalAmount * 0.3 * 100) / 100;
  const remainingAmount = Math.max(0, totalAmount - (job.depositPaid ? depositAmount : 0));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="w-9 h-9 rounded-xl object-contain bg-white/10 p-1" />
            ) : (
              <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-md shadow-indigo-900/40">
                <Briefcase className="w-4 h-4" />
              </div>
            )}
            <div>
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest block">Client Portal</span>
              <h1 className="text-base font-extrabold text-white leading-tight">{settings.name || "V79 TIQUET"}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-3 py-1 rounded-full">
              <ShieldCheck className="w-3.5 h-3.5" /> Secure Client Session
            </span>
            <span className="text-xs text-slate-400 bg-slate-800/80 px-3 py-1 rounded-full border border-slate-700/60">
              Ref: <span className="font-mono text-slate-200">{job.id.slice(0, 8)}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Success Notification */}
      {successToast && (
        <div className="bg-emerald-600 text-white px-6 py-2.5 text-center text-xs font-bold flex items-center justify-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4" />
          <span>{successToast}</span>
          <button onClick={() => setSuccessToast(null)} className="ml-4 underline cursor-pointer text-emerald-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Hero Section */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 rounded-3xl p-6 md:p-8 border border-slate-800 shadow-2xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 bg-indigo-950/80 border border-indigo-800/60 px-2.5 py-0.5 rounded-md">
                  Project Workspace
                </span>
                <span className="text-xs text-slate-400">• Created {new Date(job.createdAt).toLocaleDateString()}</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">{job.title}</h2>
              <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
                {job.description || "Track deliverables, milestones, approvals, and collaborate directly with your project manager."}
              </p>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 shrink-0 flex flex-col items-start md:items-end justify-center min-w-[200px]">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Valuation</span>
              <span className="text-3xl font-black text-emerald-400 tracking-tight mt-1">
                {currencySymbol}
                {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <div className="mt-2 flex items-center gap-2 text-[11px] font-medium">
                {job.depositPaid ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> 30% Deposit Paid
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Deposit Pending
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stepper Progress */}
          <div className="mt-8 pt-8 border-t border-slate-800/80">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Project Progression</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {STAGES.map((st, idx) => {
                const isPassed = currentStageIndex >= idx;
                const isCurrent = currentStageIndex === idx;
                return (
                  <div
                    key={st.id}
                    className={`p-3 rounded-2xl border transition-all ${
                      isCurrent
                        ? "bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-950/50"
                        : isPassed
                        ? "bg-slate-900/80 border-slate-700/80 text-slate-200"
                        : "bg-slate-950/40 border-slate-900 text-slate-600"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                          isPassed ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-500"
                        }`}
                      >
                        {idx + 1}
                      </span>
                      {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />}
                    </div>
                    <p className="text-xs font-semibold leading-tight line-clamp-1">{st.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Two-Column Grid: Actions & Details / Live Thread */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Scope, Line Items & Payment CTAs */}
          <div className="lg:col-span-7 space-y-6">
            {/* Quick Action Approval Card */}
            <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                Required Client Actions
              </h3>

              <div className="space-y-3">
                {/* Action 1: Quote Approval */}
                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-slate-200">1. Formal Quote Approval</p>
                    <p className="text-xs text-slate-400">Review project line items and grant formal go-ahead.</p>
                  </div>
                  {job.quoteApproved ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-3 py-1.5 rounded-xl">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                    </span>
                  ) : (
                    <button
                      onClick={handleApproveQuote}
                      disabled={actionLoading === "approve"}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                    >
                      {actionLoading === "approve" ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Approve Quote
                    </button>
                  )}
                </div>

                {/* Action 2: 30% Deposit */}
                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-slate-200">
                      2. Initial Deposit ({currencySymbol}
                      {depositAmount.toLocaleString()})
                    </p>
                    <p className="text-xs text-slate-400">Required prior to kickoff and milestone allocation.</p>
                  </div>
                  {job.depositPaid ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-3 py-1.5 rounded-xl">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                    </span>
                  ) : (
                    <button
                      onClick={handlePayDeposit}
                      disabled={actionLoading === "deposit"}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                    >
                      {actionLoading === "deposit" ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Pay Deposit
                    </button>
                  )}
                </div>

                {/* Action 3: Final Balance */}
                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-950/70 border border-slate-800">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-slate-200">
                      3. Final Settlement ({currencySymbol}
                      {remainingAmount.toLocaleString()})
                    </p>
                    <p className="text-xs text-slate-400">Releases final project assets upon milestone completion.</p>
                  </div>
                  {job.status === "paid" ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-3 py-1.5 rounded-xl">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Settled
                    </span>
                  ) : (
                    <button
                      onClick={handlePayFinal}
                      disabled={actionLoading === "final" || !job.depositPaid}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                    >
                      {actionLoading === "final" ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Settle Balance
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Line Items & Scope Breakdown */}
            <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" />
                Line Items & Project Scope
              </h3>

              {job.lineItems && job.lineItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                        <th className="pb-3">Description</th>
                        <th className="pb-3 text-center">Qty</th>
                        <th className="pb-3 text-right">Rate</th>
                        <th className="pb-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 text-slate-300">
                      {job.lineItems.map((item, i) => (
                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 pr-4 font-medium">{item.description}</td>
                          <td className="py-3 text-center">{item.quantity}</td>
                          <td className="py-3 text-right font-mono">
                            {currencySymbol}
                            {item.rate.toLocaleString()}
                          </td>
                          <td className="py-3 text-right font-mono font-bold text-slate-100">
                            {currencySymbol}
                            {(item.total || item.quantity * item.rate).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-slate-400 py-4 italic">No granular line items attached to this proposal.</p>
              )}
            </div>

            {/* Deliverables & Assets */}
            {job.deliverables && job.deliverables.length > 0 && (
              <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-400" />
                  Project Deliverables & Artifacts
                </h3>
                <div className="space-y-2">
                  {job.deliverables.map((del) => (
                    <div
                      key={del.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                          <FileText className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-slate-200">{del.name}</span>
                      </div>
                      {del.url ? (
                        <a
                          href={del.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                        >
                          Download <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Pending upload</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Live Direct Communication Thread */}
          <div className="lg:col-span-5 flex flex-col bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden h-[620px]">
            <div className="p-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Direct Message Thread</h3>
                <p className="text-[11px] text-slate-400">Direct, real-time channel with your project manager.</p>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Live sync connected" />
            </div>

            {/* Chat History */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/40">
              {job.messages && job.messages.length > 0 ? (
                job.messages.map((msg) => {
                  const isClient = msg.sender === "Client";
                  return (
                    <div key={msg.id} className={`flex flex-col ${isClient ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-500">
                        <span className="font-semibold text-slate-400">{msg.sender}</span>
                        <span>•</span>
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                          isClient
                            ? "bg-indigo-600 text-white rounded-tr-xs"
                            : "bg-slate-800 text-slate-200 border border-slate-700/60 rounded-tl-xs"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <Mail className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-xs font-semibold">No messages yet</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">Send any project requirements or questions below.</p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Send Input */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-slate-900 flex items-center gap-2">
              <input
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type a message to your team..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
              />
              <button
                type="submit"
                disabled={sendingMessage || !messageText.trim()}
                className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-all disabled:opacity-40 cursor-pointer"
              >
                {sendingMessage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </form>
          </div>
        </div>

        {/* Footer Contact Details */}
        <footer className="pt-8 border-t border-slate-800/80 text-center text-xs text-slate-500 space-y-2">
          <p className="font-semibold text-slate-400">{settings.name || "V79 TIQUET"} Support & Services</p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px]">
            {settings.email && (
              <a href={`mailto:${settings.email}`} className="flex items-center gap-1 hover:text-indigo-400 transition-colors">
                <Mail className="w-3 h-3" /> {settings.email}
              </a>
            )}
            {settings.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" /> {settings.phone}
              </span>
            )}
            {settings.website && (
              <a href={settings.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-indigo-400 transition-colors">
                <ExternalLink className="w-3 h-3" /> {settings.website}
              </a>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
