// Site-wide search: teams, rostered players, this week's games, and a link-out to news search.
// The player list comes from the 32 rosters the news tagger already loads (cached hourly here).
const sportsDataService = require('./sportsDataService');

let indexMemo = null;
const getIndex = async () => {
  if (indexMemo && indexMemo.at > Date.now() - 3600e3) return indexMemo.index;
  const { buildIndex } = require('./newsService');
  indexMemo = { index: await buildIndex(), at: Date.now() };
  return indexMemo.index;
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’]/g, '').trim();

// 0 = no match; higher = better (exact > prefix > whole word > word prefix > substring).
const rank = (q, text) => {
  const t = norm(text);
  if (!t || !q) return 0;
  if (t === q) return 4;
  if (t.startsWith(q)) return 3;
  const words = t.split(/\s+/);
  if (words.includes(q)) return 2.5; // "love" -> Jordan Love before Colston Loveland
  if (words.some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
};

const search = async (query, { limit = 8 } = {}) => {
  const q = norm(query);
  if (q.length < 2) return { query, teams: [], players: [], games: [] };
  const index = await getIndex();
  const teams = index.teams
    .map((t) => ({ t, s: Math.max(rank(q, t.name), rank(q, t.short_name), rank(q, t.location), norm(t.abbreviation) === q ? 5 : 0) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4)
    .map(({ t }) => ({ id: t.id, abbreviation: t.abbreviation, name: t.name, logo: t.logo, url: `/teams/${t.abbreviation}` }));
  const players = [...index.players.values()]
    .map((p) => ({ p, s: rank(q, p.name) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, limit)
    .map(({ p }) => ({ id: p.id, name: p.name, team: p.team, position: p.position, url: `/players/${p.id}` }));
  // Games this week involving a matched team (or a matched player's team).
  const teamSet = new Set([...teams.map((t) => t.abbreviation), ...(teams.length ? [] : players.slice(0, 2).map((p) => p.team))]);
  let games = [];
  if (teamSet.size) {
    const board = await sportsDataService.getUpcomingScoreboard().catch(() => null);
    games = (board?.games || []).filter((g) => teamSet.has(g.home?.abbreviation) || teamSet.has(g.away?.abbreviation)).slice(0, 4).map((g) => ({
      id: g.game_id, name: `${g.away?.abbreviation} @ ${g.home?.abbreviation}`, date: g.date, state: g.status?.state,
      detail: g.status?.detail, url: g.status?.state === 'pre' ? `/preview/${g.game_id}` : `/game/${g.game_id}`
    }));
  }
  return { query, teams, players, games, news_url: `/news?q=${encodeURIComponent(query)}` };
};

module.exports = { search, rank, norm };
