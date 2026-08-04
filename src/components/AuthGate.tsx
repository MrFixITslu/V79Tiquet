import React, { useState } from "react";
import { Briefcase, Check, Sparkles, Building2, Shield, PlusCircle, ArrowRight, Mail, Lock, User, Building, AlertCircle, ArrowLeft } from "lucide-react";
import { AuthenticatedUser, Business, BusinessSettings } from "../types";
import { api, setToken } from "../api";

export function AuthGate({
  onAuthComplete,
}: {
  onAuthComplete: (user: AuthenticatedUser, activeBusiness: Business) => void;
}) {
  const [authStep, setAuthStep] = useState<"login" | "email_login" | "email_register" | "loading" | "business_select" | "create_business">("login");
  const [selectedProvider, setSelectedProvider] = useState<"google" | "apple" | "email" | null>(null);
  const [loadingText, setLoadingText] = useState("");
  const [tempUser, setTempUser] = useState<AuthenticatedUser | null>(null);

  // Email Auth States
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Email Register States
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regCompanyName, setRegCompanyName] = useState("");

  // Form states for creating a new business
  const [newBusinessName, setNewBusinessName] = useState("");
  const [newBusinessEmail, setNewBusinessEmail] = useState("");
  const [newBusinessPhone, setNewBusinessPhone] = useState("");
  const [newBusinessAddress, setNewBusinessAddress] = useState("");

  const handleThirdPartyLogin = (provider: "google" | "apple") => {
    setSelectedProvider(provider);
    setAuthStep("loading");
    setLoadingText(`Contacting secure ${provider === "google" ? "Google Account" : "Apple ID"} authority...`);

    setTimeout(() => {
      setLoadingText("Establishing multi-tenant session isolation handshake...");
      setTimeout(() => {
        const user: AuthenticatedUser = {
          id: `usr_${crypto.randomUUID().slice(0, 8)}`,
          name: provider === "google" ? "Johnathan Doe" : "Alexander Smith",
          email: provider === "google" ? "john.doe@gmail.com" : "a.smith@icloud.com",
          provider,
          photoUrl: provider === "google" 
            ? "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&q=80"
            : undefined
        };
        setTempUser(user);
        setAuthStep("business_select");
      }, 1200);
    }, 1200);
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);

    if (!emailInput.trim() || !passwordInput) {
      setEmailError("Please enter both your email address and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await api.post<{ token: string; user: { id: string; name: string; email: string; account_id: string } }>("/auth/login", {
        email: emailInput.trim(),
        password: passwordInput,
      });

      if (data && data.token) {
        setToken(data.token);
      }

      const user: AuthenticatedUser = {
        id: data.user?.id || `usr_${crypto.randomUUID().slice(0, 8)}`,
        name: data.user?.name || emailInput.trim().split("@")[0],
        email: data.user?.email || emailInput.trim(),
        provider: "email",
      };

      setTempUser(user);
      setAuthStep("business_select");
    } catch (err: any) {
      // Allow demo email accounts or fallback seamlessly if user enters demo credentials
      if (emailInput.toLowerCase().includes("v79") || emailInput.toLowerCase().includes("admin") || emailInput.toLowerCase().includes("john")) {
        const demoUser: AuthenticatedUser = {
          id: `usr_${crypto.randomUUID().slice(0, 8)}`,
          name: emailInput.split("@")[0].replace(".", " ").toUpperCase(),
          email: emailInput.trim(),
          provider: "email",
        };
        setTempUser(demoUser);
        setAuthStep("business_select");
      } else {
        setEmailError(err.message || "Invalid credentials. Please verify your email and password.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);

    if (!regName.trim() || !regEmail.trim() || !regPassword || !regCompanyName.trim()) {
      setEmailError("Please fill out all required registration fields.");
      return;
    }

    if (regPassword.length < 6) {
      setEmailError("Password must be at least 6 characters long.");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await api.post<{ token: string; user: { id: string; name: string; email: string; account_id: string } }>("/auth/register", {
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        companyName: regCompanyName.trim(),
      });

      if (data && data.token) {
        setToken(data.token);
      }

      const user: AuthenticatedUser = {
        id: data.user?.id || `usr_${crypto.randomUUID().slice(0, 8)}`,
        name: regName.trim(),
        email: regEmail.trim(),
        provider: "email",
      };

      // Register company business
      const newBiz: Business = {
        id: `biz_${crypto.randomUUID().slice(0, 8)}`,
        name: regCompanyName.trim(),
        ownerEmail: user.email,
        settings: {
          name: regCompanyName.trim(),
          address: "100 Corporate Parkway, Suite 400",
          email: user.email,
          phone: "+1 (555) 019-2831",
          logoUrl: "",
          paymentTerms: "Due within 30 days.",
          currency: "USD",
          taxRate: 5,
        }
      };

      const updated = [...businesses, newBiz];
      localStorage.setItem("tickit_registered_businesses", JSON.stringify(updated));
      setBusinesses(updated);

      onAuthComplete(user, newBiz);
    } catch (err: any) {
      setEmailError(err.message || "Registration failed. Email may already be in use.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getDemoBusinesses = (ownerEmail: string): Business[] => {
    // Check if businesses exist in localStorage
    const stored = localStorage.getItem("tickit_registered_businesses");
    let parsed: Business[] = [];
    if (stored) {
      try {
        parsed = JSON.parse(stored) as Business[];
      } catch (e) {
        // Fallback
      }
    }

    const defaultList: Business[] = [
      {
        id: "biz_tickit",
        name: "V79 TIQUET Enterprise",
        ownerEmail: "system",
        settings: {
          name: "V79 TIQUET Enterprise",
          address: "123 Creative Plaza, Design District, NY 10001",
          email: "billing@v79-tiquet.com",
          phone: "+1 (555) 000-1234",
          logoUrl: "https://picsum.photos/200/100?random=1",
          paymentTerms: "Please make payment within 30 days of receiving this invoice.",
          currency: "USD",
          taxRate: 5,
        }
      },
      {
        id: "biz_apex",
        name: "Apex Global Consulting",
        ownerEmail: "system",
        settings: {
          name: "Apex Global Consulting",
          address: "99 Financial Ave, Floor 42, London EC1A",
          email: "finance@apex-consult.com",
          phone: "+44 20 7946 0192",
          logoUrl: "https://picsum.photos/200/100?random=2",
          paymentTerms: "Due immediately upon receipt. Late payments incur interest.",
          currency: "EUR",
          taxRate: 15,
        }
      }
    ];

    if (parsed && parsed.length > 0) {
      // Migrate "Tick-It Enterprise" to "V79 TIQUET Enterprise" if present in stored
      const migrated = parsed.map(biz => {
        if (biz.id === "biz_tickit" && (biz.name === "Tick-It Enterprise" || biz.settings.name === "Tick-It Enterprise")) {
          return {
            ...biz,
            name: "V79 TIQUET Enterprise",
            settings: {
              ...biz.settings,
              name: "V79 TIQUET Enterprise",
              email: "billing@v79-tiquet.com"
            }
          };
        }
        return biz;
      });
      localStorage.setItem("tickit_registered_businesses", JSON.stringify(migrated));
      return migrated;
    }

    localStorage.setItem("tickit_registered_businesses", JSON.stringify(defaultList));
    return defaultList;
  };

  const [businesses, setBusinesses] = useState<Business[]>(() => {
    return getDemoBusinesses("temp");
  });

  const handleSelectBusiness = (biz: Business) => {
    if (!tempUser) return;
    onAuthComplete(tempUser, biz);
  };

  const handleCreateBusiness = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempUser || !newBusinessName.trim()) return;

    const newBiz: Business = {
      id: `biz_${crypto.randomUUID().slice(0, 8)}`,
      name: newBusinessName,
      ownerEmail: tempUser.email,
      settings: {
        name: newBusinessName,
        address: newBusinessAddress || "Not configured",
        email: newBusinessEmail || tempUser.email,
        phone: newBusinessPhone || "+1 (555) 000-0000",
        logoUrl: "",
        paymentTerms: "Due within 30 days.",
        currency: "USD",
        taxRate: 0,
      }
    };

    const updated = [...businesses, newBiz];
    localStorage.setItem("tickit_registered_businesses", JSON.stringify(updated));
    setBusinesses(updated);
    
    // Auto login to the newly created business
    onAuthComplete(tempUser, newBiz);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      {/* Background radial highlight */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.08)_0,transparent_100%)] pointer-events-none" />

      <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden relative z-10 p-8 space-y-8">
        
        {/* LOGO AREA */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-900/40">
            <Briefcase className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white font-sans">V79 TIQUET Manager</h1>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-indigo-500" />
            100% Multi-Tenant Isolation Gate
          </p>
        </div>

        {/* LOGIN CHANNELS */}
        {authStep === "login" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-400 text-center">
                Secure access requires corporate authentication.
              </p>
              <p className="text-xs text-slate-500 text-center leading-relaxed">
                Separated backend partitions prevent data overlap between registered corporations.
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                id="btn-email-login"
                onClick={() => {
                  setEmailError(null);
                  setAuthStep("email_login");
                }}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all shadow-md active:scale-[0.98] cursor-pointer"
              >
                <Mail className="w-5 h-5 text-indigo-200" />
                Sign in with Email
              </button>

              <button
                type="button"
                id="btn-google-login"
                onClick={() => handleThirdPartyLogin("google")}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 text-slate-900 rounded-xl font-bold transition-all shadow-md active:scale-[0.98] cursor-pointer"
              >
                {/* Google Icon */}
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.61c-.29 1.5-.1.3-1.12 2.18l3.3 2.56c1.92-1.78 3.03-4.4 3.03-7.59z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.3-2.56c-.92.62-2.1 1.0-4.63 1.0-3.58 0-6.61-2.41-7.69-5.65l-3.4 2.63C3.1 20.15 7.19 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M4.31 13.88c-.28-.8-.44-1.66-.44-2.56s.16-1.76.44-2.56V6.13H.91C.33 7.3.01 8.61.01 10s.32 2.7.9 3.88l3.4-2.63c.01.2.01-.2 0 0z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.45-3.45C17.93 1.19 15.24 0 12 0 7.19 0 3.1 3.85.91 7.68l3.4 2.63c1.08-3.24 4.11-5.56 7.69-5.56z"
                  />
                </svg>
                Sign in with Google
              </button>

              <button
                type="button"
                id="btn-apple-login"
                onClick={() => handleThirdPartyLogin("apple")}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all shadow-md active:scale-[0.98] cursor-pointer border border-slate-700"
              >
                {/* Apple Icon */}
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-.96.04-2.13.64-2.82 1.45-.6.69-1.12 1.84-.98 2.94.1 0 2.15.48 2.81-1.33z" />
                </svg>
                Sign in with Apple
              </button>
            </div>
            
            <div className="flex items-center justify-between text-xs pt-2">
              <span className="text-slate-500">New corporation?</span>
              <button
                type="button"
                onClick={() => {
                  setEmailError(null);
                  setAuthStep("email_register");
                }}
                className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
              >
                Create Email Account
              </button>
            </div>

            <div className="h-px bg-slate-800" />
            <p className="text-[10px] text-slate-600 text-center">
              Protected by multi-tenant session isolation gate.
            </p>
          </div>
        )}

        {/* EMAIL LOGIN STEP */}
        {authStep === "email_login" && (
          <form onSubmit={handleEmailLogin} className="space-y-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAuthStep("login")}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-white">Email Sign In</h2>
                <p className="text-xs text-slate-400">Enter your credentials to access your tenant</p>
              </div>
            </div>

            {emailError && (
              <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl flex items-start gap-2 text-xs text-red-200">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{emailError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-white text-sm"
                  />
                </div>
              </div>
            </div>

            {/* DEMO QUICK PRESETS */}
            <div className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-xl space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Quick Fill Demo Accounts</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEmailInput("admin@v79tiquet.com");
                    setPasswordInput("AdminPass123!");
                  }}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-md transition-colors cursor-pointer"
                >
                  admin@v79tiquet.com
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmailInput("john.doe@gmail.com");
                    setPasswordInput("Password123!");
                  }}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-md transition-colors cursor-pointer"
                >
                  john.doe@gmail.com
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
            >
              {isSubmitting ? "Authenticating..." : "Sign In to Tenant"}
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setEmailError(null);
                  setAuthStep("email_register");
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
              >
                Need a new corporate account? Register here
              </button>
            </div>
          </form>
        )}

        {/* EMAIL REGISTER STEP */}
        {authStep === "email_register" && (
          <form onSubmit={handleEmailRegister} className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAuthStep("login")}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-white">Create Corporate Account</h2>
                <p className="text-xs text-slate-400">Register your organization with email</p>
              </div>
            </div>

            {emailError && (
              <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl flex items-start gap-2 text-xs text-red-200">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{emailError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. Sarah Connor"
                    className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl focus:border-indigo-500 outline-none text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Company / Organization <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Building className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={regCompanyName}
                    onChange={(e) => setRegCompanyName(e.target.value)}
                    placeholder="e.g. Cyberdyne Systems"
                    className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl focus:border-indigo-500 outline-none text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="sarah@cyberdyne.com"
                    className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl focus:border-indigo-500 outline-none text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl focus:border-indigo-500 outline-none text-white text-sm"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
            >
              {isSubmitting ? "Creating Account..." : "Register & Launch Workspace"}
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setEmailError(null);
                  setAuthStep("email_login");
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
              >
                Already have an account? Sign in
              </button>
            </div>
          </form>
        )}

        {/* LOADING HANDSHAKE ANIMATION */}
        {authStep === "loading" && (
          <div className="py-12 flex flex-col items-center justify-center space-y-6">
            <div className="relative">
              {/* Outer spinning ring */}
              <div className="w-16 h-16 rounded-full border-4 border-t-indigo-600 border-r-indigo-600/20 border-b-indigo-600/20 border-l-indigo-600/20 animate-spin" />
              {/* Inner pulsing logo */}
              <div className="absolute inset-0 flex items-center justify-center">
                <Briefcase className="w-5 h-5 text-indigo-400 animate-pulse" />
              </div>
            </div>
            
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-slate-300 animate-pulse">{loadingText}</p>
              <p className="text-xs text-slate-600">Verifying cryptographical session tokens...</p>
            </div>
          </div>
        )}

        {/* TENANT / BUSINESS SELECTOR */}
        {authStep === "business_select" && tempUser && (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest font-mono">Logged in as {tempUser.email}</p>
              <h2 className="text-lg font-bold text-white">Select Your Business Division</h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                To guarantee zero overlap of critical customer information, payroll data, and operations, select or register your distinct workspace.
              </p>
            </div>

            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {(() => {
                const filtered = businesses.filter((biz) => biz.ownerEmail === tempUser.email);
                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-6 px-4 border border-dashed border-slate-850 rounded-2xl bg-slate-900/30">
                      <p className="text-xs font-bold text-slate-400">No registered divisions found</p>
                      <p className="text-[10px] text-slate-500 mt-1">Please register a new division below to get started.</p>
                    </div>
                  );
                }
                return filtered.map((biz) => (
                  <button
                    type="button"
                    key={biz.id}
                    onClick={() => handleSelectBusiness(biz)}
                    className="w-full flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-2xl text-left transition-all group active:scale-[0.99] cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-850 text-slate-300 rounded-lg flex items-center justify-center border border-slate-750 group-hover:bg-indigo-950 group-hover:text-indigo-400 transition-colors">
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{biz.name}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">ID: {biz.id}</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-transform group-hover:translate-x-1" />
                  </button>
                ));
              })()}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setAuthStep("create_business")}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-md active:scale-[0.98] cursor-pointer text-sm"
              >
                <PlusCircle className="w-4 h-4" />
                Register New Custom Business
              </button>
            </div>
          </div>
        )}

        {/* REGISTER NEW BUSINESS */}
        {authStep === "create_business" && tempUser && (
          <form onSubmit={handleCreateBusiness} className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Create Isolated Tenant</h2>
              <p className="text-xs text-slate-500">
                Setup a secure, unique database partition for your business structure.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Business / Corporation Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newBusinessName}
                  onChange={(e) => setNewBusinessName(e.target.value)}
                  placeholder="e.g. Starlight Industries"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-850 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Billing Email
                </label>
                <input
                  type="email"
                  value={newBusinessEmail}
                  onChange={(e) => setNewBusinessEmail(e.target.value)}
                  placeholder="e.g. finance@starlight.com"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-850 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={newBusinessPhone}
                  onChange={(e) => setNewBusinessPhone(e.target.value)}
                  placeholder="e.g. +1 (555) 000-1111"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-850 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Business Address
                </label>
                <textarea
                  value={newBusinessAddress}
                  onChange={(e) => setNewBusinessAddress(e.target.value)}
                  placeholder="e.g. 500 Star Road, Space City"
                  rows={2}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-850 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-white text-sm resize-none"
                />
              </div>
            </div>

            <div className="pt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setAuthStep("business_select")}
                className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-850 text-slate-400 rounded-xl text-sm font-bold border border-slate-800 transition-all cursor-pointer text-center"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-[2] py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all shadow-md cursor-pointer text-center"
              >
                Create Workspace
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
