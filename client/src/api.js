import { useEffect, useState, useCallback } from 'react';

export async function api(path) {
  const res = await fetch(`/api${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// Fetches `path`; re-polls every `refreshMs` while `shouldRefresh(body)` is true.
export function useApi(path, { refreshMs = 0, shouldRefresh = () => false } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  const load = useCallback(async (silent) => {
    if (!path) { setState({ data: null, error: null, loading: false }); return null; }
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const body = await api(path);
      setState({ data: body, error: null, loading: false });
      return body;
    } catch (error) {
      setState((s) => ({ data: silent ? s.data : null, error, loading: false }));
      return null;
    }
  }, [path]);

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

  return state;
}

export const isLive = (game) => game?.status?.state === 'in';

export function formatKickoff(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function dayKey(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
