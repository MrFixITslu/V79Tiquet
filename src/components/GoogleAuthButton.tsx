import React, { useState } from "react";
import { GoogleOAuthProvider, GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { Loader2, AlertCircle, Info, ExternalLink, Key } from "lucide-react";

interface GoogleAuthButtonProps {
  clientId: string | null;
  onSuccess: (credential: string) => void;
  onError: (errorMessage: string) => void;
  loading?: boolean;
  onClientConfigured?: (newClientId: string) => void;
}

export function GoogleAuthButton({
  clientId,
  onSuccess,
  onError,
  loading = false,
  onClientConfigured,
}: GoogleAuthButtonProps) {
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [customClientId, setCustomClientId] = useState("");

  const activeClientId = clientId || customClientId.trim();

  const handleApplyCustomId = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customClientId.trim()) return;
    if (onClientConfigured) {
      onClientConfigured(customClientId.trim());
    }
    setShowConfigModal(false);
  };

  return (
    <div className="w-full">
      {activeClientId ? (
        <div className="w-full flex justify-center [&>div]:!w-full [&_iframe]:!w-full">
          <GoogleOAuthProvider clientId={activeClientId}>
            <GoogleLogin
              onSuccess={(res: CredentialResponse) => {
                if (res.credential) {
                  onSuccess(res.credential);
                } else {
                  onError("Google login succeeded but no credential token was received.");
                }
              }}
              onError={() => {
                onError("Google sign-in popup was closed or origin was not authorized.");
              }}
              theme="outline"
              size="large"
              shape="rectangular"
              text="continue_with"
              width="100%"
            />
          </GoogleOAuthProvider>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setShowConfigModal(true)}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl font-semibold text-sm transition-all shadow-sm cursor-pointer hover:border-slate-400 active:scale-[0.99]"
          >
            <GoogleIcon className="w-5 h-5" />
            <span>Continue with Google</span>
          </button>
        </div>
      )}

      {/* Setup Guide / Configuration Modal if not configured yet */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 text-left">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <GoogleIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Google OAuth Setup</h3>
                <p className="text-xs text-slate-500">Domain: <span className="font-mono text-indigo-600">tiquet.v79sl.com</span></p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              To enable <strong>Sign in with Google</strong> for your workspace, ensure you have registered this domain in your Google Cloud Console project.
            </p>

            <div className="space-y-2 mb-4 text-xs text-slate-600 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <p className="font-bold text-slate-800 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-500" />
                Google Console OAuth 2.0 Settings:
              </p>
              <ul className="list-disc list-inside space-y-1 pl-1 text-slate-600">
                <li><strong>Application Type:</strong> Web Application</li>
                <li><strong>Authorized JavaScript origins:</strong>
                  <code className="block mt-0.5 px-2 py-1 bg-white border border-slate-200 rounded text-slate-800 select-all font-mono text-[11px]">https://tiquet.v79sl.com</code>
                </li>
              </ul>
            </div>

            <form onSubmit={handleApplyCustomId} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Google Client ID (Quick Test)
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="xxxxxxxxxxxx-xxxxxxxx.apps.googleusercontent.com"
                    value={customClientId}
                    onChange={(e) => setCustomClientId(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-slate-800"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Or add <code className="font-bold text-slate-600">GOOGLE_CLIENT_ID=...</code> to your host <code className="font-bold text-slate-600">.env</code>.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={!customClientId.trim()}
                  className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer"
                >
                  Activate Google Sign-In
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold text-xs transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}
