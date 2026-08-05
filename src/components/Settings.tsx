import React, { useState, useEffect } from "react";
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  Globe,
  Shield,
  Bell,
  Palette,
  Save,
  Image as ImageIcon,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Send,
  Loader2,
} from "lucide-react";
import { BusinessSettings, Industry, EmailTemplate, EmailTemplateType, NewsletterSend } from "../types";
import { api } from "../api";

export function Settings({
  settings,
  setSettings,
  industries,
  setIndustries,
}: {
  settings: BusinessSettings;
  setSettings: (settings: BusinessSettings) => void;
  industries: Industry[];
  setIndustries: React.Dispatch<React.SetStateAction<Industry[]>>;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSettings({
      ...settings,
      [name]: name === "taxRate" ? parseFloat(value) : value,
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
        <p className="text-slate-500 text-sm mt-1">
          Configure your business profile, invoice defaults, and application preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Business Profile</h3>
          <p className="text-sm text-slate-500">
            This information will appear on your generated invoices and documents.
          </p>
        </div>
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-20 h-20 bg-slate-100 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden relative group">
                {settings.logoUrl ? (
                  <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-slate-300" />
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                  <span className="text-[10px] text-white font-bold uppercase">Change</span>
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Logo URL</label>
                <input
                  type="text"
                  name="logoUrl"
                  value={settings.logoUrl}
                  onChange={handleChange}
                  placeholder="https://example.com/logo.png"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Business Name</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    name="name"
                    value={settings.name}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    name="email"
                    value={settings.email}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    name="phone"
                    value={settings.phone}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Website</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="www.example.com"
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Address</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                <textarea
                  name="address"
                  value={settings.address}
                  onChange={handleChange}
                  rows={3}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm resize-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-slate-200" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Invoice Defaults</h3>
          <p className="text-sm text-slate-500">
            Set default values for new invoices to save time.
          </p>
        </div>
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Currency</label>
                <select
                  name="currency"
                  value={settings.currency}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="CAD">CAD ($)</option>
                  <option value="XCD">XCD (EC$)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Default Tax Rate (%)</label>
                <input
                  type="number"
                  name="taxRate"
                  value={settings.taxRate}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Default Payment Terms</label>
              <textarea
                name="paymentTerms"
                value={settings.paymentTerms}
                onChange={handleChange}
                rows={3}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm resize-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-slate-200" />

      <IndustriesSection industries={industries} setIndustries={setIndustries} />

      <div className="h-px bg-slate-200" />

      <TemplatesSection />

      <div className="h-px bg-slate-200" />

      <NewsletterSection industries={industries} />

      <div className="flex justify-end gap-3 pt-4">
        <button className="px-6 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-xl transition-colors">
          Discard Changes
        </button>
        <button className="px-8 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center gap-2">
          <Save className="w-4 h-4" />
          Save Settings
        </button>
      </div>
    </div>
  );
}

// ── Industries ───────────────────────────────────────────────────────────────

function IndustriesSection({
  industries,
  setIndustries,
}: {
  industries: Industry[];
  setIndustries: React.Dispatch<React.SetStateAction<Industry[]>>;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    setIndustries([...industries, { id: crypto.randomUUID(), name }]);
    setNewName("");
  };

  const handleSaveEdit = (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    setIndustries(industries.map((i) => (i.id === id ? { ...i, name } : i)));
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this industry? Clients using it will show no industry, not be deleted.")) return;
    setIndustries(industries.filter((i) => i.id !== id));
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="md:col-span-1">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Industries</h3>
        <p className="text-sm text-slate-500">
          Manage the industry dropdown used on client records — also used to group newsletter broadcasts.
        </p>
      </div>
      <div className="md:col-span-2 space-y-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          {industries.length === 0 && (
            <p className="text-sm text-slate-400 italic">No industries yet — add one below.</p>
          )}
          {industries.map((ind) => (
            <div key={ind.id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-slate-50">
              {editingId === ind.id ? (
                <>
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(ind.id)}
                    className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button onClick={() => handleSaveEdit(ind.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-slate-700">{ind.name}</span>
                  <button
                    onClick={() => { setEditingId(ind.id); setEditingName(ind.name); }}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(ind.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="e.g. Hospitality"
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <button
              onClick={handleAdd}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Email Templates (Welcome + Newsletter) ─────────────────────────────────────

const MERGE_FIELD_HINT =
  "Available: {{client_name}} {{company_name}} {{company_address}} {{company_phone}} {{company_email}} {{site_url}} {{opt_in_link}}";

function TemplatesSection() {
  const [activeType, setActiveType] = useState<EmailTemplateType>("welcome");
  const [templates, setTemplatesState] = useState<Record<EmailTemplateType, EmailTemplate | null>>({
    welcome: null,
    newsletter: null,
  });
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const rows = await api.get<EmailTemplate[]>("/templates");
        const byType: Record<EmailTemplateType, EmailTemplate | null> = { welcome: null, newsletter: null };
        rows.forEach((t) => { byType[t.type] = t; });
        setTemplatesState(byType);
      } catch (e) {
        console.error("Failed to load templates", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const t = templates[activeType];
    setSubject(t?.subject || "");
    setHtmlBody(t?.htmlBody || "");
    setSavedMsg(null);
    setTestMsg(null);
  }, [activeType, templates]);

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg(null);
    try {
      const updated = await api.put<EmailTemplate>(`/templates/${activeType}`, { subject, htmlBody });
      setTemplatesState((prev) => ({ ...prev, [activeType]: updated }));
      setSavedMsg("Saved.");
    } catch (e: any) {
      setSavedMsg(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    setSendingTest(true);
    setTestMsg(null);
    try {
      const result = await api.post<{ success: boolean; error?: string }>(`/templates/${activeType}/test`);
      setTestMsg(result.success ? "Test email sent to your account email." : (result.error || "Failed to send."));
    } catch (e: any) {
      setTestMsg(e.message || "Failed to send test email.");
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="md:col-span-1">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Email Templates</h3>
        <p className="text-sm text-slate-500">
          Edit the welcome email sent to new clients and the newsletter content used for broadcasts.
        </p>
      </div>
      <div className="md:col-span-2 space-y-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex gap-2">
            {(["welcome", "newsletter"] as EmailTemplateType[]).map((type) => (
              <button
                key={type}
                onClick={() => setActiveType(type)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  activeType === type ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {type === "welcome" ? "Welcome Email" : "Newsletter"}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">HTML Content</label>
                <textarea
                  value={htmlBody}
                  onChange={(e) => setHtmlBody(e.target.value)}
                  rows={12}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-xs font-mono resize-y"
                />
                <p className="text-xs text-slate-400 mt-1">{MERGE_FIELD_HINT}</p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-all disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Template"}
                </button>
                <button
                  onClick={handleSendTest}
                  disabled={sendingTest || !subject || !htmlBody}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  {sendingTest ? "Sending..." : "Send Test to Me"}
                </button>
                {savedMsg && <span className="text-sm text-slate-500">{savedMsg}</span>}
                {testMsg && <span className="text-sm text-slate-500">{testMsg}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Newsletter Broadcast ─────────────────────────────────────────────────────

function NewsletterSection({ industries }: { industries: Industry[] }) {
  const [industryId, setIndustryId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sends, setSends] = useState<NewsletterSend[]>([]);
  const [loadingSends, setLoadingSends] = useState(true);

  const loadSends = async () => {
    setLoadingSends(true);
    try {
      const rows = await api.get<NewsletterSend[]>("/newsletter/sends");
      setSends(rows);
    } catch (e) {
      console.error("Failed to load newsletter history", e);
    } finally {
      setLoadingSends(false);
    }
  };

  useEffect(() => { loadSends(); }, []);

  const handleBroadcast = async () => {
    const groupLabel = industryId ? industries.find((i) => i.id === industryId)?.name || "that group" : "all opted-in clients";
    if (!confirm(`Send the current newsletter template to ${groupLabel}? This can't be undone.`)) return;

    setSending(true);
    setMessage(null);
    try {
      const result = await api.post<{ started: boolean; recipientCount: number }>("/newsletter/broadcast", {
        industryId: industryId || null,
      });
      setMessage(`Sending to ${result.recipientCount} client${result.recipientCount === 1 ? "" : "s"}...`);
      setTimeout(loadSends, 4000);
    } catch (e: any) {
      setMessage(e.message || "Failed to start broadcast.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="md:col-span-1">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Newsletter Broadcast</h3>
        <p className="text-sm text-slate-500">
          Sends the saved Newsletter template (edit it above) to opted-in clients. Edit the template
          any time between broadcasts — a snapshot of what was sent is kept in the history below.
        </p>
      </div>
      <div className="md:col-span-2 space-y-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Send to</label>
              <select
                value={industryId}
                onChange={(e) => setIndustryId(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
              >
                <option value="">All opted-in clients</option>
                {industries.map((ind) => (
                  <option key={ind.id} value={ind.id}>{ind.name} (opted-in only)</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleBroadcast}
              disabled={sending}
              className="px-6 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-all disabled:opacity-50 flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              {sending ? "Starting..." : "Broadcast"}
            </button>
          </div>
          {message && <p className="text-sm text-slate-500">{message}</p>}

          <div className="pt-4 border-t border-slate-100">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Recent Sends</h4>
            {loadingSends ? (
              <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
            ) : sends.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No broadcasts sent yet.</p>
            ) : (
              <div className="space-y-2">
                {sends.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm p-2.5 rounded-lg hover:bg-slate-50">
                    <div>
                      <div className="font-medium text-slate-700">{s.subject}</div>
                      <div className="text-xs text-slate-400">
                        {new Date(s.sentAt).toLocaleString()} · {s.recipientCount} recipient{s.recipientCount === 1 ? "" : "s"}
                        {s.industryId ? ` · ${industries.find((i) => i.id === s.industryId)?.name || "a group"}` : " · all clients"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
