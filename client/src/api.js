import { useEffect, useState, useCallback } from 'react';

const sessionCache = new Map();

export async function api(path, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`/api${path}`, { signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// Fetches `path`; re-polls every `refreshMs` while `shouldRefresh(body)` is true.
export function useApi(path, { refreshMs = 0, shouldRefresh = () => false, timeoutMs = 15000 } = {}) {
  const [state, setState] = useState({ data: path ? sessionCache.get(path)?.data || null : null, error: null, loading: Boolean(path), stale: false, lastUpdated: sessionCache.get(path)?.updatedAt || null });

  const load = useCallback(async (silent) => {
    if (!path) { setState({ data: null, error: null, loading: false, stale: false, lastUpdated: null }); return null; }
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const body = await api(path, { timeoutMs });
      const updatedAt = new Date().toISOString();
      sessionCache.set(path, { data: body, updatedAt });
      setState({ data: body, error: null, loading: false, stale: false, lastUpdated: updatedAt });
      return body;
    } catch (error) {
      setState((s) => {
        const cached = s.data || sessionCache.get(path)?.data || null;
        return { data: cached, error, loading: false, stale: Boolean(cached), lastUpdated: s.lastUpdated || sessionCache.get(path)?.updatedAt || null };
      });
      return null;
    }
  }, [path, timeoutMs]);

  useEffect(() => {
    let timer;
    let cancelled = false;
    const tick = async (silent) => {
      const body = await load(silent);
      if (!cancelled && refreshMs && body && shouldRefresh(body)) {
        timer = setTimeout(() => tick(true), refreshMs);
      }
    };
    tick(false);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshMs]);

  return { ...state, retry: () => load(false) };
}

export const isLive = (game) => game?.status?.state === 'in';

export function formatKickoff(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function dayKey(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
