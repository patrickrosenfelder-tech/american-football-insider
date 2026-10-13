import { useEffect, useState, useCallback, useRef } from 'react';

const sessionCache = new Map();

export function getFavoriteTeams() {
  try { return JSON.parse(localStorage.getItem('afi-favorite-teams') || '[]'); } catch { return []; }
}

export function toggleFavoriteTeam(abbreviation) {
  const favorites = getFavoriteTeams();
  const next = favorites.includes(abbreviation) ? favorites.filter((x) => x !== abbreviation) : [...favorites, abbreviation];
  localStorage.setItem('afi-favorite-teams', JSON.stringify(next));
  return next;
}

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
  const initial = () => ({ path, data: sessionCache.get(path)?.data || null, error: null, loading: Boolean(path), stale: false, lastUpdated: sessionCache.get(path)?.updatedAt || null });
  const [state, setState] = useState(initial);
  const latestPath = useRef(path);
  const requestId = useRef(0);
  latestPath.current = path;

  const load = useCallback(async (silent) => {
    const id = ++requestId.current;
    if (!path) { setState({ path, data: null, error: null, loading: false, stale: false, lastUpdated: null }); return null; }
    if (!silent) setState((s) => ({ ...(s.path === path ? s : initial()), loading: true, error: null }));
    try {
      const body = await api(path, { timeoutMs });
      const updatedAt = new Date().toISOString();
      sessionCache.set(path, { data: body, updatedAt });
      if (latestPath.current !== path || requestId.current !== id) return null;
      setState({ path, data: body, error: null, loading: false, stale: false, lastUpdated: updatedAt });
      return body;
    } catch (error) {
      if (latestPath.current !== path || requestId.current !== id) return null;
      setState((s) => {
        const cached = (s.path === path ? s.data : null) || sessionCache.get(path)?.data || null;
        return { path, data: cached, error, loading: false, stale: Boolean(cached), lastUpdated: (s.path === path ? s.lastUpdated : null) || sessionCache.get(path)?.updatedAt || null };
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
    return () => { cancelled = true; requestId.current += 1; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshMs]);

  return { ...(state.path === path ? state : initial()), retry: () => load(false) };
}

export const isLive = (game) => game?.status?.state === 'in';

export function formatKickoff(iso) {
  const d = new Date(iso);
  return `${d.toLocaleString(undefined, { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`;
}

export function dayKey(iso) {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
}

export const formatTimestamp = (iso) => iso ? `${new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET` : '–';
