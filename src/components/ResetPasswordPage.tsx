import React, { useState } from "react";
import { Briefcase, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../api";

/**
 * Handles both halves of the forgot-password flow in one component:
 *  - No token in the URL -> "request a reset link" form (POST /auth/forgot-password)
 *  - Token in the URL (/reset-password/:token) -> "set a new password" form
 *    (POST /auth/reset-password)
 *
 * Rendered by App.tsx based on window.location.pathname, ahead of the
 * session-restore / AuthGate logic, since this needs to work whether or
 * not the visitor currently has a valid session.
 */
export function ResetPasswordPage({ token, onBackToLogin }: { token: string | null; onBackToLogin: () => void }) {
  return token ? <ConfirmResetForm token={token} onBackToLogin={onBackToLogin} /> : <RequestResetForm onBackToLogin={onBackToLogin} />;
}

function Shell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-8 pb-6 text-center border-b border-slate-100">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Briefcase className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">V79 TIQUET</h1>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  );
}

function RequestResetForm({ onBackToLogin }: { onBackToLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Server intentionally returns the same generic success response
      // whether or not the email has an account — don't try to branch on
      // its content here, that would defeat the point.
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Shell subtitle="Check your email">
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          <p className="text-sm text-slate-600">
            If an account exists for <span className="font-semibold text-slate-800">{email}</span>, we've sent a
            password reset link. It expires in 30 minutes.
          </p>
          <button
            type="button"
            onClick={onBackToLogin}
            className="mt-2 text-sm text-indigo-600 font-bold hover:underline cursor-pointer"
          >
            Back to sign in
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell subtitle="Reset your password">
      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-500">
          Enter the email on your account and we'll send you a link to reset your password.
        </p>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            placeholder="you@company.com"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl font-bold text-sm transition-colors shadow-md cursor-pointer"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          Send Reset Link
        </button>
        <p className="text-center text-xs text-slate-400 mt-4">
          <button type="button" onClick={onBackToLogin} className="text-indigo-600 font-bold hover:underline cursor-pointer">
            Back to sign in
          </button>
        </p>
      </form>
    </Shell>
  );
}

function ConfirmResetForm({ token, onBackToLogin }: { token: string; onBackToLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
    } catch (e) {
      // Covers both an invalid/expired link and a password that fails the
      // server's validatePassword() rules — the server message is specific
      // enough to show directly.
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Shell subtitle="Password reset">
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          <p className="text-sm text-slate-600">Your password has been reset. You can now sign in.</p>
          <button
            type="button"
            onClick={onBackToLogin}
            className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm transition-colors shadow-md cursor-pointer"
          >
            Sign In <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell subtitle="Choose a new password">
      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">New Password</label>
          <input
            type="password"
            required
            value={password}
            placeholder="At least 8 characters"
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Confirm Password</label>
          <input
            type="password"
            required
            value={confirmPassword}
            placeholder="••••••••"
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-slate-800"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl font-bold text-sm transition-colors shadow-md cursor-pointer"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          Reset Password
        </button>
      </form>
    </Shell>
  );
}
