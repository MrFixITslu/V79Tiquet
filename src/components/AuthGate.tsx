import React, { useState } from "react";
import { Briefcase, Shield, ArrowRight, Loader2, KeyRound } from "lucide-react";
import { AuthenticatedUser, Business } from "../types";
import { api, setToken, ApiError } from "../api";

type Step = "login" | "register" | "2fa";

export function AuthGate({
  onAuthComplete,
}: {
  onAuthComplete: (user: AuthenticatedUser, activeBusiness: Business) => void;
}) {
  const [step, setStep] = useState<Step>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Login fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  // Register fields
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regCompany, setRegCompany] = useState("");

  const finishLogin = async (token: string) => {
    setToken(token);
    try {
      const me = await api.get<{ id: string; name: string; email: string; role: string; account_id: string }>("/auth/me");
      const settings = await api.get<any>("/settings");

      const user: AuthenticatedUser = {
        id: me.id,
        name: me.name,
        email: me.email,
        provider: "email",
      };
      const business: Business = {
        id: me.account_id,
        name: settings?.name || "My Business",
        ownerEmail: me.email,
        settings: {
          name: settings?.name || "",
          address: settings?.address || "",
          email: settings?.email || me.email,
          phone: settings?.phone || "",
          logoUrl: settings?.logoUrl || "",
          paymentTerms: settings?.paymentTerms || "Please make payment within 30 days of receiving this invoice.",
          currency: settings?.currency || "USD",
          taxRate: settings?.taxRate || 0,
        },
      };
      onAuthComplete(user, business);
    } catch (e) {
      setToken(null);
      setError("Signed in, but couldn't load your workspace. Please try again.");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<any>("/auth/login", { email, password });
      if (res.requires2FA) {
        setTempToken(res.tempToken);
        setStep("2fa");
      } else {
        await finishLogin(res.token);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<any>("/auth/login/2fa", { tempToken, code });
      await finishLogin(res.token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<any>("/auth/register", {
        name: regName,
        email: regEmail,
        password: regPassword,
        companyName: regCompany,
      });
      await finishLogin(res.token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-8 pb-6 text-center border-b border-slate-100">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Briefcase className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">V79 TIQUET</h1>
          <p className="text-sm text-slate-500 mt-1">
            {step === "register" ? "Create your workspace" : step === "2fa" ? "Two-factor verification" : "Sign in to your workspace"}
          </p>
        </div>

        <div className="p-8">
          {error && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {step === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <Field label="Email" type="email" required value={email} onChange={setEmail} placeholder="you@company.com" />
              <Field label="Password" type="password" required value={password} onChange={setPassword} placeholder="••••••••" />
              <SubmitButton loading={loading} label="Sign In" />
              <p className="text-center text-xs text-slate-400 mt-4">
                Don't have a workspace?{" "}
                <button type="button" onClick={() => { setStep("register"); setError(null); }} className="text-indigo-600 font-bold hover:underline cursor-pointer">
                  Create one
                </button>
              </p>
            </form>
          )}

          {step === "register" && (
            <form onSubmit={handleRegister} className="space-y-4">
              <Field label="Your Name" required value={regName} onChange={setRegName} placeholder="Jane Doe" />
              <Field label="Company Name" required value={regCompany} onChange={setRegCompany} placeholder="Acme Design Co." />
              <Field label="Email" type="email" required value={regEmail} onChange={setRegEmail} placeholder="you@company.com" />
              <Field label="Password" type="password" required value={regPassword} onChange={setRegPassword} placeholder="At least 8 characters" />
              <SubmitButton loading={loading} label="Create Workspace" />
              <p className="text-center text-xs text-slate-400 mt-4">
                Already have a workspace?{" "}
                <button type="button" onClick={() => { setStep("login"); setError(null); }} className="text-indigo-600 font-bold hover:underline cursor-pointer">
                  Sign in
                </button>
              </p>
            </form>
          )}

          {step === "2fa" && (
            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                <Shield className="w-4 h-4 text-indigo-500 shrink-0" />
                Enter the 6-digit code from your authenticator app.
              </div>
              <Field label="Verification Code" required value={code} onChange={setCode} placeholder="123456" icon={<KeyRound className="w-4 h-4" />} />
              <SubmitButton loading={loading} label="Verify" />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</label>
      <div className="relative">
        {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</div>}
        <input
          type={type}
          required={required}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full ${icon ? "pl-9" : "px-4"} pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800`}
        />
      </div>
    </div>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl font-bold text-sm transition-colors shadow-md cursor-pointer"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
      {label}
    </button>
  );
}
