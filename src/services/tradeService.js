const axios = require('axios');
const db = require('../db/database');
const { assetUrl, streamCsv } = require('./nflverseService');
const { ESPN_SITE, getTeams } = require('./sportsDataService');
const news = require('./newsService');
const { currentSeason } = require('./rosterService');

const TRADES_KEY = (season) => `trades_${season}`;
const FA_KEY = (season) => `free_agents_${season}`;
const TX_URL = `${ESPN_SITE}/transactions`;
const rumorWords = /trade talks|shopping|interest in|could trade|deadline|sources say|available for trade|trade candidate/i;
const completeWords = /traded to|acquire[ds]?|deal sends|lands with/i;

const dateOnly = (d) => String(d || '').slice(0, 10);
const pickText = (r) => r.pick_round ? `${r.pick_season} Round ${r.pick_round}${r.pick_number ? `, Pick ${r.pick_number}` : ''}${r.conditional === '1' ? ' (conditional)' : ''}` : null;

async function refreshTrades(season = currentSeason()) {
  const grouped = new Map();
  await streamCsv(assetUrl('trades', 'trades.csv'), (r) => {
    if (Number(r.season) !== Number(season)) return;
    const t = grouped.get(r.trade_id) || { id: String(r.trade_id), date: r.trade_date, teams: {} };
    const side = t.teams[r.gave] || { team: r.gave, receives: [] };
    const item = r.pfr_name || pickText(r);
    if (item) side.receives.push(item);
    t.teams[r.gave] = side; grouped.set(r.trade_id, t);
  }, { columns: ['trade_id', 'season', 'trade_date', 'gave', 'received', 'pick_season', 'pick_round', 'pick_number', 'conditional', 'pfr_name'] });
  const trades = [...grouped.values()].map((t) => ({ ...t, teams: Object.values(t.teams), status: 'Completed' })).sort((a, b) => b.date.localeCompare(a.date));
  await db.saveDataset(TRADES_KEY(season), { season, trades, source: 'nflverse trades.csv', updated_at: new Date().toISOString() });
  return { trades: trades.length };
}

async function transactions() {
  const { data } = await axios.get(TX_URL, { timeout: 15000, params: { limit: 1000 }, headers: { 'User-Agent': 'American-Football-Insider/1.0' } });
  return data.transactions || [];
}

async function refreshFreeAgents(season = currentSeason()) {
  const tx = await transactions();
  const released = tx.filter((x) => /released|waived/i.test(x.description || ''));
  const signed = tx.filter((x) => /signed/i.test(x.description || ''));
  const signedNames = new Set(signed.map((x) => (x.description.match(/(?:signed|re-signed)\s+(?:[A-Z]{1,3}\s+)?([^,.]+?)(?:\s+to|\.|$)/i)?.[1] || '').toLowerCase()).filter(Boolean));
  const agents = released.map((x, i) => {
    const m = x.description.match(/(?:released|waived)\s+(?:[A-Z]{1,3}\s+)?([^,.]+?)(?:\.|$)/i);
    const name = m?.[1]?.trim() || x.description;
    return { id: `${dateOnly(x.date)}-${i}`, name, position: (x.description.match(/(?:released|waived)\s+([A-Z]{1,3})\s+/i)?.[1] || 'FA'), age: null,
      last_team: x.team?.abbreviation || null, status: `Released ${dateOnly(x.date)}`, released_date: x.date, score: 50 - i / 10, key_stats: 'Transaction-based listing; seasonal production refreshes with nflverse stats.', headshot: null,
      signed: signedNames.has(name.toLowerCase()), team_fits: [] };
  }).filter((a) => !a.signed).slice(0, 100);
  await db.saveDataset(FA_KEY(season), { season, agents, source: 'ESPN transactions (released/waived)', updated_at: new Date().toISOString() });
  return { players: agents.length };
}

async function getTrades({ season = currentSeason(), team, position } = {}) {
  let row = await db.loadDataset(TRADES_KEY(season));
  if (!row) { await refreshTrades(season); row = await db.loadDataset(TRADES_KEY(season)); }
  let trades = row?.data?.trades || [];
  if (team) trades = trades.filter((t) => t.teams.some((s) => s.team === String(team).toUpperCase()));
  if (position) trades = trades.filter((t) => t.teams.some((s) => s.receives.some((x) => new RegExp(`\\b${position}\\b`, 'i').test(x))));
  return { season: Number(season), trades, source: row?.data?.source || 'nflverse trades.csv', last_updated: row?.updated_at || null };
}

async function getRumors() {
  const feed = await news.list({ limit: 200 });
  const all = [...(feed.stories || []), ...(feed.headlines || [])];
  const byTitle = new Map();
  all.filter((s) => rumorWords.test(s.title || '')).forEach((s) => {
    const key = (s.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 8).join(' ');
    const r = byTitle.get(key) || { id: s.id, title: s.title, summary: s.excerpt || 'Reported trade interest; see linked source for details.', teams: s.teams || [], first_seen: s.published, last_updated: s.published, sources: [], mentions: 0, status: 'Active' };
    r.sources.push(...(s.sources || [])); r.mentions += s.source_count || 1; if (s.published > r.last_updated) r.last_updated = s.published; byTitle.set(key, r);
  });
  return { rumors: [...byTitle.values()].map((r) => ({ ...r, status: Date.now() - Date.parse(r.last_updated) > 21 * 864e5 ? 'Cold' : r.status })).sort((a, b) => b.last_updated.localeCompare(a.last_updated)), source: 'AFI news feed (RSS + ESPN)' };
}

async function getFreeAgents() {
  const season = currentSeason(); let row = await db.loadDataset(FA_KEY(season));
  if (!row) { await refreshFreeAgents(season); row = await db.loadDataset(FA_KEY(season)); }
  return { ...(row?.data || { season, agents: [] }), last_updated: row?.updated_at || null,
    formula: 'AFI FA score = last two seasons’ snaps × positional value × production, adjusted for age. During initial data collection, released/waived players are ranked by recency; production components fill as nflverse stats refresh.' };
}

module.exports = { refreshTrades, refreshFreeAgents, getTrades, getRumors, getFreeAgents, transactions };
