import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { api } from "./api";

type Row = Record<string, any> & { id: string };

/**
 * Keeps a React state array in sync with a REST collection endpoint, without
 * requiring every child component to be rewritten. Child components already
 * call setX(fullNewArray) with the whole next array computed locally (this
 * was the existing localStorage-era pattern) — this hook just diffs that
 * against what the server last returned and fires the matching create /
 * update / delete calls, then reconciles from the server response.
 */
export function useSyncedCollection<T extends Row>(endpoint: string, enabled: boolean) {
  const [items, setItemsState] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevRef = useRef<T[]>([]);
  const syncingRef = useRef(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<T[]>(endpoint);
      prevRef.current = data;
      setItemsState(data);
    } catch (e: any) {
      setError(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [endpoint, enabled]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, endpoint]);

  const setItems = useCallback(
    (updater: T[] | ((prev: T[]) => T[])) => {
      setItemsState((prev) => {
        const next = typeof updater === "function" ? (updater as (p: T[]) => T[])(prev) : updater;
        const before = prevRef.current;
        prevRef.current = next;
        void syncDiff<T>(endpoint, before, next, syncingRef, (reconciled) => {
          prevRef.current = reconciled;
          setItemsState(reconciled);
        });
        return next;
      });
    },
    [endpoint]
  );

  return { items, setItems, loading, error, reload };
}

async function syncDiff<T extends Row>(
  endpoint: string,
  prev: T[],
  next: T[],
  syncingRef: MutableRefObject<boolean>,
  onReconciled: (items: T[]) => void
) {
  const prevIds = new Set(prev.map((p) => p.id));
  const nextIds = new Set(next.map((n) => n.id));
  let didFail = false;

  for (const p of prev) {
    if (!nextIds.has(p.id)) {
      try {
        await api.del(`${endpoint}/${p.id}`);
      } catch (e) {
        console.error(`Failed to delete ${endpoint}/${p.id}`, e);
        didFail = true;
      }
    }
  }

  const created: Record<string, T> = {};
  for (const n of next) {
    if (!prevIds.has(n.id)) {
      try {
        created[n.id] = await api.post<T>(endpoint, n);
      } catch (e) {
        console.error(`Failed to create in ${endpoint}`, e);
        didFail = true;
      }
    }
  }

  for (const n of next) {
    if (prevIds.has(n.id)) {
      const before = prev.find((p) => p.id === n.id);
      if (before && JSON.stringify(before) !== JSON.stringify(n)) {
        try {
          await api.put(`${endpoint}/${n.id}`, n);
        } catch (e) {
          console.error(`Failed to update ${endpoint}/${n.id}`, e);
          didFail = true;
        }
      }
    }
  }

  // Reconcile ids the server assigned differently than the client-generated
  // optimistic id (shouldn't normally happen since creates pass the client
  // id through, but this keeps state honest if it ever does).
  if (Object.keys(created).length > 0) {
    const reconciled = next.map((n) => (created[n.id] ? { ...n, ...created[n.id] } : n));
    onReconciled(reconciled);
  }

  if (didFail) {
    console.warn(`Some changes to ${endpoint} failed to sync with the server.`);
  }
}
