import { useEffect, useState } from "react";
import { api } from "../api";
import { ClipboardCopy, FilePenLine, RefreshCcw, ShieldCheck } from "lucide-react";

type Draft = {
  id: string; jobId: string; content: string; createdBy: string;
  status: "DRAFT"; createdAt: string;
};

export function AgentReplyDraftPanel({ jobId }: { jobId: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    try {
      const response = await api.get<{ drafts: Draft[]; executionEnabled: boolean }>(
        `/jobs/${encodeURIComponent(jobId)}/agent-drafts`);
      if (!Array.isArray(response.drafts) || response.executionEnabled !== false)
        throw new Error("Unexpected internal draft response.");
      setDrafts(response.drafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load ticket drafts.");
    }
  };
  useEffect(() => { setDrafts([]); setContent(""); setError(""); void refresh(); }, [jobId]);

  const save = async () => {
    if (busy || !content.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const idempotencyKey = "staffdraft_" + crypto.randomUUID().replaceAll("-", "");
      const response = await api.post<{ draft: Draft; executionEnabled: boolean; sent: boolean }>(
        `/jobs/${encodeURIComponent(jobId)}/agent-drafts`,
        { content: content.trim(), idempotencyKey },
      );
      if (!response.draft || response.draft.status !== "DRAFT" ||
          response.executionEnabled !== false || response.sent !== false)
        throw new Error("Unsafe internal draft response.");
      setContent("");
      setNotice("Draft saved privately. Nothing was sent to the customer.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save ticket draft.");
    } finally { setBusy(false); }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied for manual review; no message sent.");
    } catch {
      setError("Clipboard permission denied.");
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 font-semibold text-slate-900">
          <FilePenLine className="h-4 w-4 text-cyan-700" /> Internal reply drafts
        </h4>
        <button onClick={() => void refresh()} className="rounded-md border border-slate-200 bg-white p-2 text-slate-700"
          aria-label="Refresh internal reply drafts"><RefreshCcw className="h-4 w-4" /></button>
      </div>
      <p className="flex items-center gap-2 text-xs text-emerald-700">
        <ShieldCheck className="h-4 w-4" /> Private staff notes only. No customer message or email is sent.
      </p>
      <p className="text-xs text-slate-500">Paste an approved Hub planning brief after verifying the ticket.
        This record stays separate from ticket messages and customer-visible notes.</p>
      <textarea value={content} onChange={e => setContent(e.target.value)}
        maxLength={2000} rows={4} placeholder="Internal draft for staff review…"
        className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900" />
      <button disabled={busy || content.trim().length < 12} onClick={() => void save()}
        className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Saving…" : "Save draft only"}
      </button>
      <div className="max-h-56 space-y-2 overflow-y-auto">
        {drafts.map(draft => (
          <article key={draft.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <p className="whitespace-pre-wrap text-slate-800">{draft.content}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <small className="text-slate-500">{new Date(draft.createdAt).toLocaleString()} · DRAFT</small>
              <button onClick={() => void copy(draft.content)} className="flex items-center gap-1 text-cyan-700">
                <ClipboardCopy className="h-3 w-3" /> Copy
              </button>
            </div>
          </article>
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}
