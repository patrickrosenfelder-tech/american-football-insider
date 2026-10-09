// Trades, trade rumors and the trade deadline.
// Completed trades merge two sources: nflverse's trades.csv (curated ledger, lags in-season) and
// ESPN's transaction wire ("Traded G Cam Jurgens ... to Baltimore in exchange for ..."), which both
// teams report separately, so the same deal is parsed from up to three records and de-duplicated.
// Rumors come from rumor-heavy feeds (ProFootballRumors, Google News trade queries) plus the stored
// AFI news feed, classified by keyword rules and grouped by player. No LLM calls are made here.

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const db = require('../db/database');
const { assetUrl, streamCsv } = require('./nflverseService');
const { ESPN_SITE, getTeams } = require('./sportsDataService');
const news = require('./newsService');
const { currentSeason } = require('./rosterService');
const profiles = require('./playerProfileService');

const TRADES_KEY = (season) => `trades_v3_${season}`;
const RUMORS_KEY = 'trade_rumors_v1';
const TX_URL = `${ESPN_SITE}/transactions`;
const UA = 'Mozilla/5.0 (compatible; American-Football-Insider/1.0; +https://american-football-insider.fly.dev)';
const http = axios.create({ timeout: 20000, headers: { 'User-Agent': UA } });
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

// 2026 trade deadline: Tuesday after Week 9, 4:00 p.m. ET (EST) = 21:00 UTC.
const DEADLINES = {
  2026: { at: '2026-11-10T21:00:00.000Z', label: 'Tuesday, Nov. 10, 2026 · 4:00 p.m. ET', source: 'NFL.com — 2026-27 NFL important dates', url: 'https://www.nfl.com/news/2026-27-national-football-league-important-dates' }
};

const dateOnly = (d) => String(d || '').slice(0, 10);
// nflverse abbreviations -> ESPN's, so both sources de-duplicate and filter the same way.
const espnAbbr = (t) => ({ LA: 'LAR', WAS: 'WSH' }[t] || t);
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const ROUNDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

// --- ESPN transactions ----------------------------------------------------------------

let txMemo = null;
const transactions = async () => {
  if (txMemo && Date.now() - txMemo.at < 30 * 60e3) return txMemo.list;
  const list = [];
  for (let page = 1; page <= 5; page += 1) {
    const { data } = await axios.get(TX_URL, { timeout: 20000, params: { limit: 1000, page }, headers: { 'User-Agent': 'American-Football-Insider/1.0' } });
    list.push(...(data.transactions || []));
    if (!data.pageCount || page >= data.pageCount) break;
  }
  txMemo = { at: Date.now(), list };
  return list;
};

// "Traded G Cam Jurgens ... Signed C James Brockermeyer ..." -> one clause per move. Splits only before
// a transaction verb so "Joey Porter Jr. to Dallas" and "J.J. McCarthy" stay intact.
const VERBS = 'Traded|Acquired|Signed|Re-signed|Resigned|Waived|Waiving|Released|Placed|Activated|Reverted|Claimed|Promoted|Elevated|Designated|Restored|Recalled|Terminated|Agreed|Exercised|Reinstated|Suspended|Announced|Removed|Converted|Named|Hired|Fired|Extended|Mutually|Received|Returned|Declined|Cut';
const clauses = (desc) => String(desc || '').split(new RegExp(`\\.\\s+(?=(?:${VERBS})\\b)`)).map((c) => c.trim().replace(/\.$/, '')).filter(Boolean);

const teamResolver = async () => {
  const teams = await getTeams();
  const names = [];
  teams.forEach((t) => {
    names.push([t.name, t.abbreviation], [t.short_name, t.abbreviation]);
  });
  // Locations are only used when unique ("Dallas" yes, "New York" / "Los Angeles" no).
  const loc = {};
  teams.forEach((t) => { (loc[t.location] ||= []).push(t.abbreviation); });
  Object.entries(loc).forEach(([l, abbrs]) => { if (abbrs.length === 1) names.push([l, abbrs[0]]); });
  names.sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    const s = String(text || '').replace(/^the\s+/i, '');
    const hit = names.find(([n]) => n && s.toLowerCase().startsWith(n.toLowerCase()));
    return hit ? hit[1] : null;
  };
};

// One asset string -> { type: 'player', position, name } | { type: 'pick', year, round, conditional, original } | { type: 'other' }.
const POS_RE = /^(QB|RB|HB|FB|WR|TE|OT|T|G|OG|C|OL|IOL|DE|DT|NT|DL|EDGE|LB|ILB|OLB|MLB|CB|DB|S|FS|SS|K|PK|P|LS)\s+(.+)$/;
const parseAsset = (raw) => {
  const s = raw.trim().replace(/^(and|a|an)\s+/i, '').replace(/^(and|a|an)\s+/i, '').trim();
  const pick = s.match(/(?:(?:the\s+)?([A-Z][A-Za-z. ]+?)['’]s?\s+)?(conditional\s+)?(\d{4})\s+(first|second|third|fourth|fifth|sixth|seventh)[- ]round(?:\s+draft)?\s+(?:pick|selection)/i);
  if (pick) return { type: 'pick', year: Number(pick[3]), round: ROUNDS[pick[4].toLowerCase()], conditional: Boolean(pick[2] || /conditional/i.test(s)), original_name: pick[1] || null };
  const p = s.match(POS_RE);
  if (p) return { type: 'player', position: p[1], name: p[2].replace(/\s+(from|off|with)\b.*$/i, '').trim() };
  if (!s || /^(future|cash|considerations)/i.test(s)) return s ? { type: 'other', text: s } : null;
  return { type: 'other', text: s };
};
const parseAssets = (text) => String(text || '')
  .split(/,\s*(?:and\s+)?|\s+and\s+(?=(?:a|an|the|conditional|\d{4}|[A-Z]{1,4}\s+[A-Z]))/)
  .map(parseAsset).filter(Boolean);

// "Traded A to TEAM (in exchange for|for) B" / "Acquired A from TEAM (in exchange for|for) B".
const parseTradeClause = (clause, self, resolve) => {
  let m = clause.match(/^Traded\s+(.+?)\s+to\s+(?:the\s+)?(.+?)(?:\s+(?:in exchange\s+)?for\s+(.+))?$/i);
  let gives;
  let receives;
  let partnerText;
  if (m) { [, gives, partnerText, receives] = m; } else {
    m = clause.match(/^Acquired\s+(.+?)\s+from\s+(?:the\s+)?(.+?)(?:\s+(?:in exchange\s+)?for\s+(.+))?$/i);
    if (!m) return null;
    [, receives, partnerText, gives] = m;
  }
  let partner = resolve(partnerText);
  if (partner === self) partner = null; // ESPN occasionally names the team itself ("DAL acquired ... from Dallas").
  return { team: self, partner, gives: parseAssets(gives), receives: parseAssets(receives) };
};

const espnTradeRecords = async () => {
  const resolve = await teamResolver();
  const records = [];
  (await transactions()).forEach((t) => {
    const self = t.team?.abbreviation;
    if (!self) return;
    clauses(t.description).forEach((c) => {
      if (!/^(Traded|Acquired)\b/i.test(c)) return;
      const r = parseTradeClause(c, self, resolve);
      if (r && (r.gives.length || r.receives.length)) records.push({ ...r, date: dateOnly(t.date), text: c, source: 'ESPN transactions' });
    });
  });
  return records;
};

// --- Trade model ---------------------------------------------------------------------

const assetKey = (a) => (a.type === 'player' ? `p:${profiles.normName(a.name)}` : a.type === 'pick' ? `k:${a.year}:${a.round}` : `o:${a.text.toLowerCase()}`);
const playerNames = (r) => [...r.gives, ...r.receives].filter((a) => a.type === 'player').map((a) => profiles.normName(a.name));

const newTrade = (id, date, source) => ({ id, date, sources: new Set([source]), sides: {} });
const side = (trade, team) => (trade.sides[team] ||= { team, gives: new Map(), receives: new Map() });
const addAsset = (map, a) => { const k = assetKey(a); if (!map.has(k)) map.set(k, a); else if (a.type === 'pick' && a.conditional) map.get(k).conditional = true; };

// A record contributes both perspectives: what self gives, the partner receives, and vice versa.
const applyRecord = (trade, r) => {
  const me = side(trade, r.team);
  r.gives.forEach((a) => addAsset(me.gives, a));
  r.receives.forEach((a) => addAsset(me.receives, a));
  if (r.partner) {
    const them = side(trade, r.partner);
    r.gives.forEach((a) => addAsset(them.receives, a));
    r.receives.forEach((a) => addAsset(them.gives, a));
  }
  // Use the date from records that name the partner correctly; garbled self-references carry odd dates.
  if (r.partner && (trade.dated_by_partner ? r.date < trade.date : true)) { trade.date = r.date; trade.dated_by_partner = true; }
  trade.sources.add(r.source);
};

const nflverseRecords = async (season) => {
  const byId = new Map();
  await streamCsv(assetUrl('trades', 'trades.csv'), (r) => {
    if (Number(r.season) !== Number(season)) return;
    const asset = r.pfr_name
      ? { type: 'player', position: null, name: r.pfr_name, pfr_id: r.pfr_id || null }
      : r.pick_round ? { type: 'pick', year: Number(r.pick_season), round: Number(r.pick_round), number: r.pick_number ? Number(r.pick_number) : null, conditional: r.conditional === '1' } : null;
    if (!asset) return;
    // Row semantics: `gave` sent the asset to `received`.
    const rec = byId.get(r.trade_id) || { id: `nfl-${r.trade_id}`, date: r.trade_date, rows: [] };
    rec.rows.push({ gave: espnAbbr(r.gave), received: espnAbbr(r.received), asset });
    byId.set(r.trade_id, rec);
  }, { columns: ['trade_id', 'season', 'trade_date', 'gave', 'received', 'pick_season', 'pick_round', 'pick_number', 'conditional', 'pfr_id', 'pfr_name'] });
  return [...byId.values()];
};

// Two records describe the same deal if they involve the same teams within two weeks and either
// share a player or, for pick-only swaps, the same pick.
const sameDeal = (trade, teams, names, picks, date) => {
  if (days(trade.date, date) > 14) return false;
  const tTeams = Object.keys(trade.sides);
  const overlapTeams = teams.filter((t) => t && tTeams.includes(t)).length;
  const tAssets = Object.values(trade.sides).flatMap((s) => [...s.gives.keys(), ...s.receives.keys()]);
  const sharedPlayer = names.some((n) => tAssets.includes(`p:${n}`));
  const sharedPick = picks.some((k) => tAssets.includes(k));
  if (sharedPlayer && overlapTeams >= 1) return true;
  return overlapTeams >= 2 && (sharedPick || !names.length);
};

const buildTrades = async (season) => {
  const trades = [];
  const errors = [];
  try {
    (await nflverseRecords(season)).forEach((rec) => {
      const t = newTrade(rec.id, rec.date, 'nflverse trades.csv');
      t.dated_by_partner = true;
      rec.rows.forEach(({ gave, received, asset }) => { addAsset(side(t, gave).gives, asset); addAsset(side(t, received).receives, asset); });
      trades.push(t);
    });
  } catch (error) { errors.push(`nflverse: ${error.message}`); }
  try {
    const records = (await espnTradeRecords()).filter((r) => Number(r.date.slice(0, 4)) === Number(season)).sort((a, b) => a.date.localeCompare(b.date));
    // Records with a resolved partner first, so self-referencing ESPN entries can join an existing deal.
    records.sort((a, b) => (a.partner ? 0 : 1) - (b.partner ? 0 : 1));
    records.forEach((r) => {
      const names = playerNames(r);
      const picks = [...r.gives, ...r.receives].filter((a) => a.type === 'pick').map(assetKey);
      const match = trades.find((t) => sameDeal(t, [r.team, r.partner], names, picks, r.date));
      if (match) { applyRecord(match, r); return; }
      if (!r.partner) return; // can't place a one-sided record that matches nothing
      const t = newTrade(`espn-${r.date}-${[r.team, r.partner].sort().join('-')}`, r.date, r.source);
      applyRecord(t, r);
      trades.push(t);
    });
  } catch (error) { errors.push(`ESPN: ${error.message}`); }
  return { trades, errors };
};

// --- Decoration: players, picks, AFI impact ---------------------------------------------

const PICK_POINTS = [0, 45, 22, 12, 7, 4, 2.5, 1.5];
const pickPoints = (a, season) => PICK_POINTS[a.round] * 0.9 ** Math.max(0, a.year - season - 1);

// AFI player value: positional value × 2026 snap share (2025 if no 2026 snaps) × age curve, on a 0-100 scale.
const ageFactor = (age, group) => {
  if (age == null) return 1;
  const peak = group === 'RB' ? 26 : group === 'QB' ? 32 : 28;
  return Math.max(0.5, 1 - Math.max(0, age - peak) * (group === 'RB' ? 0.1 : 0.06));
};
const playerValue = (p, age) => {
  const s = p.seasons[2026]?.snap_games ? p.seasons[2026] : p.seasons[2025];
  const share = profiles.snapShare(s) || 0;
  return Math.round(100 * (profiles.POS_VALUE[p.group] || 0.3) * (share / 100) * ageFactor(age, p.group) * 10) / 10;
};

const decoratePlayer = (a, prof, teamHint) => {
  const p = (a.pfr_id && prof.byPfr[a.pfr_id]) || profiles.findByName(prof, a.name, { position: a.position, team: teamHint });
  if (!p) return { type: 'player', name: a.name, position: a.position, headshot: null, age: null, value: 0, snap_share_2026: null, key_stats: null };
  const age = profiles.ageOn(p.birth_date);
  return {
    type: 'player', name: p.name, position: a.position || p.position, espn_id: p.espn_id, headshot: p.headshot, age,
    snap_share_2026: profiles.snapShare(p.seasons[2026]), snaps_2026: profiles.snapsOf(p.seasons[2026]) || 0,
    key_stats: profiles.keyStats(p, 2026) || (profiles.keyStats(p, 2025) ? `2025: ${profiles.keyStats(p, 2025)}` : null),
    value: playerValue(p, age)
  };
};

const finishTrade = (t, prof, resolveName, season) => {
  const teams = Object.keys(t.sides);
  const sides = teams.map((team) => {
    const s = t.sides[team];
    const other = teams.find((x) => x !== team);
    const fmt = (a, from) => {
      if (a.type === 'player') return decoratePlayer(a, prof, from);
      if (a.type === 'pick') {
        const original = (a.original_name && resolveName(a.original_name)) || from;
        return { type: 'pick', year: a.year, round: a.round, number: a.number || null, conditional: Boolean(a.conditional), original_team: original,
          label: `${a.year} ${ORD[a.round]}-round pick${a.number ? ` (#${a.number})` : ''}${a.conditional ? ' (conditional)' : ''}${original && original !== from ? ` (via ${original})` : ''}`,
          value: Math.round(pickPoints(a, season) * 10) / 10 };
      }
      return { type: 'other', label: a.text, value: 0 };
    };
    const gives = [...s.gives.values()].map((a) => fmt(a, team));
    const receives = [...s.receives.values()].map((a) => fmt(a, other));
    const sum = (list) => Math.round(list.reduce((n, x) => n + (x.value || 0), 0) * 10) / 10;
    return { team, gives, receives, impact: { value_in: sum(receives), value_out: sum(gives), net: Math.round((sum(receives) - sum(gives)) * 10) / 10 } };
  });
  return { id: t.id, date: t.date, status: 'Completed', teams: sides, sources: [...t.sources] };
};

async function buildTradeList(season) {
  const [{ trades, errors }, prof, resolveName] = await Promise.all([buildTrades(season), profiles.loadProfiles(), teamResolver()]);
  const list = trades.filter((t) => Object.keys(t.sides).length >= 2).map((t) => finishTrade(t, prof, resolveName, season))
    .sort((a, b) => b.date.localeCompare(a.date));
  await db.saveDataset(TRADES_KEY(season), { season, trades: list, source: 'nflverse trades.csv + ESPN transactions', errors, updated_at: new Date().toISOString() }, { trades: list.length });
  return { trades: list.length, ...(errors.length ? { error: errors.join('; ') } : {}) };
}

// Single flight per job: hourly job, boot and cold page views share one in-progress build.
const inflight = {};
const once = (key, fn) => (inflight[key] ||= fn().finally(() => { delete inflight[key]; }));
const refreshTrades = (season = currentSeason()) => once(`trades_${season}`, () => buildTradeList(season));
const refreshRumors = () => once('rumors', buildRumors);

async function getTrades({ season = currentSeason(), team, position } = {}) {
  let row = await db.loadDataset(TRADES_KEY(season));
  if (!row) { await refreshTrades(season); row = await db.loadDataset(TRADES_KEY(season)); }
  let trades = row?.data?.trades || [];
  if (team) trades = trades.filter((t) => t.teams.some((s) => s.team === String(team).toUpperCase()));
  if (position) {
    const g = profiles.groupOf(position);
    trades = trades.filter((t) => t.teams.some((s) => s.gives.some((x) => x.type === 'player' && (profiles.groupOf(x.position) === g || x.position === String(position).toUpperCase()))));
  }
  return { season: Number(season), trades, source: row?.data?.source || 'nflverse trades.csv + ESPN transactions', last_updated: row?.updated_at || null, deadline: deadline(season) };
}

const deadline = (season = currentSeason()) => {
  const d = DEADLINES[season];
  if (!d) return null;
  return { ...d, passed: Date.now() > Date.parse(d.at), days_left: Math.max(0, Math.ceil((Date.parse(d.at) - Date.now()) / 864e5)) };
};

// --- Rumors -------------------------------------------------------------------------------

const RUMOR = /trade (talks?|rumou?rs?|interest|market|block|candidates?|request|chatter|buzz|calls|inquir\w*|options|targets?|value|discussions?)|\bshopping\b|interest(ed)? in\b|could (trade|be traded|be dealt|move|deal|land|pursue|target)|trade deadline|sources say|on the (trading )?block|available (for|via) trade|listening to offers|explor\w* (a )?trade|\bpursu(e|ing)\b|\beyeing\b|\binquir\w*|request(s|ed)? (a )?trade|(not|no) (interested in )?(trading|moving|shopping)|linked to|connected to|might (trade|deal)|fielding calls|would (trade|consider)|trade (him|away)|\bon the move\b/i;
const SPECULATIVE = /could|would|might|should|talks|interest|rumou?r|candidate|block|shopping|explor|consider|listening|pursu|eyeing|target|inquir|linked|connected|request|calls|not /i;
const COMPLETED = /\b(trades?|traded|acquires?|acquired|sends?|deal(s)? for|lands?)\b.*\b(to|from|for)\b|\bgrades?\b|trade tracker|every (deal|trade)/i;
const NOT_NEWS = /fantasy|\bodds\b|betting|\bprops?\b|mock draft|power rankings|subscriber chat|\bpodcast\b/i;

const classify = (title) => {
  if (NOT_NEWS.test(title)) return null;
  if (COMPLETED.test(title) && !SPECULATIVE.test(title)) return 'completed';
  if (RUMOR.test(title)) return 'rumor';
  return null;
};

const GOOGLE_QUERIES = ['NFL trade rumors', 'NFL trade talks', 'NFL trade interest', 'NFL trade deadline buyers sellers'];
const googleUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&hl=en-US&gl=US&ceid=US:en`;

const fetchFeed = async (url, defaultOutlet) => {
  const { data } = await http.get(url, { responseType: 'text' });
  const items = [].concat(xml.parse(data)?.rss?.channel?.item || []);
  return items.map((it) => {
    const outlet = it.source?.['#text'] || defaultOutlet;
    let title = news.stripHtml(it.title?.['#text'] ?? it.title);
    if (it.source?.['#text']) title = title.replace(new RegExp(`\\s+-\\s+${it.source['#text'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
    return { title, outlet, url: typeof it.link === 'string' ? it.link : it.guid?.['#text'] || it.guid, published: it.pubDate ? new Date(it.pubDate).toISOString() : null };
  }).filter((i) => i.title && i.url && i.published);
};

const collectRumorItems = async () => {
  const feeds = [
    { name: 'ProFootballRumors', url: 'https://www.profootballrumors.com/feed' },
    ...GOOGLE_QUERIES.map((q) => ({ name: `Google News: ${q}`, url: googleUrl(q) }))
  ];
  const errors = {};
  const results = await Promise.all(feeds.map((f) => fetchFeed(f.url, f.name.startsWith('Google') ? 'Google News' : f.name).catch((e) => { errors[f.name] = e.message; return []; })));
  const items = results.flat();
  // Stored AFI news stories (headlines and summarized stories alike) and their source headlines.
  const row = await db.loadDataset(news.DATASET).catch(() => null);
  Object.values(row?.data?.stories || {}).forEach((s) => {
    if (s.kind === 'headline') (s.sources || []).forEach((x) => items.push({ title: x.title, outlet: x.name, url: x.url, published: x.published, story_id: s.id, ai_title: s.ai_title || null }));
  });
  return { items, errors };
};

// Primary player = the first rostered player named in the headline (plain substring scan over all
// rostered names, so "Cardinals’ Marvin Harrison Jr." still resolves).
const norm = (t) => ` ${String(t).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9.' -]/g, ' ').replace(/\s+/g, ' ')} `;
const primaryPlayer = (item, index) => {
  const tagged = news.tagItem({ title: item.title, description: '', espn_team_ids: [], espn_athletes: [] }, index);
  const title = norm(item.title);
  let best = null;
  index.players.forEach((p, name) => {
    const at = title.indexOf(` ${name.replace(/[’']/g, "'")} `) >= 0 ? title.indexOf(` ${name.replace(/[’']/g, "'")} `) : title.indexOf(` ${name.replace(/[’']/g, "'")}'`);
    if (at < 0) return;
    if (!best || at < best.at || (at === best.at && name.length > best.p.name.length)) best = { at, p };
  });
  const teams = [...tagged.teams];
  if (best?.p.team && !teams.includes(best.p.team)) teams.unshift(best.p.team);
  return { player: best ? best.p : null, teams };
};

const summaryFor = (r) => {
  const p = r.player;
  const others = r.teams.filter((t) => t !== p?.team);
  const lead = p ? `${p.name} (${p.position || 'player'}, ${p.team || 'FA'})` : `The ${r.teams.join('/')}`;
  const outlets = r.outlets.length;
  return `${lead} ${p ? 'has' : 'have'} come up in trade talk in ${outlets} outlet${outlets === 1 ? '' : 's'} since ${new Date(r.first_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}`
    + `${others.length ? `, with ${others.join(', ')} linked` : ''}. Latest: “${r.headline}”.`;
};

async function buildRumors() {
  const [{ items, errors }, index, tradesRow] = await Promise.all([collectRumorItems(), news.buildIndex(), db.loadDataset(TRADES_KEY(currentSeason()))]);
  const row = await db.loadDataset(RUMORS_KEY);
  const store = row?.data?.rumors || {};
  const cutoff = Date.now() - 30 * 864e5;
  let added = 0;
  items.forEach((item) => {
    if (Date.parse(item.published) < cutoff) return;
    if (classify(item.title) !== 'rumor') return;
    const { player, teams } = primaryPlayer(item, index);
    if (!player && !teams.length) return;
    const key = player ? `p-${player.id}` : `t-${[...teams].sort().join('-')}`;
    const r = store[key] || { id: key, player: player ? { id: player.id, name: player.name, position: player.position || null, team: player.team || null } : null, teams: [], sources: [], first_seen: item.published, last_updated: item.published };
    teams.forEach((t) => { if (!r.teams.includes(t)) r.teams.push(t); });
    if (r.player?.team && !r.teams.includes(r.player.team)) r.teams.unshift(r.player.team);
    if (!r.sources.some((s) => s.url === item.url || (s.title === item.title && s.outlet === item.outlet))) { r.sources.push({ outlet: item.outlet, title: item.title, url: item.url, published: item.published }); added += 1; }
    if (item.published < r.first_seen) r.first_seen = item.published;
    if (item.published > r.last_updated) r.last_updated = item.published;
    store[key] = r;
  });
  // Resolve: a completed trade moving the player after the rumor started -> "Happened".
  const trades = tradesRow?.data?.trades || [];
  Object.values(store).forEach((r) => {
    r.sources.sort((a, b) => b.published.localeCompare(a.published));
    r.outlets = [...new Set(r.sources.map((s) => s.outlet))];
    r.mentions = r.outlets.length;
    r.headline = r.sources[0]?.title || '';
    const name = r.player && profiles.normName(r.player.name);
    const since = dateOnly(new Date(Date.parse(r.first_seen) - 3 * 864e5).toISOString());
    const done = name && trades.find((t) => t.date >= since
      && t.teams.some((s) => s.gives.some((x) => x.type === 'player' && profiles.normName(x.name) === name)));
    r.status = done ? 'Happened' : Date.now() - Date.parse(r.last_updated) > 21 * 864e5 ? 'Cold' : 'Active';
    r.trade_id = done ? done.id : null;
    r.summary = summaryFor(r);
    if (Date.now() - Date.parse(r.last_updated) > 60 * 864e5) delete store[r.id];
  });
  await db.saveDataset(RUMORS_KEY, { rumors: store, errors, updated_at: new Date().toISOString() }, { rumors: Object.keys(store).length });
  return { rumors: Object.keys(store).length, added };
}

async function getRumors() {
  let row = await db.loadDataset(RUMORS_KEY);
  if (!row) { await refreshRumors(); row = await db.loadDataset(RUMORS_KEY); }
  const order = { Active: 0, Happened: 1, Cold: 2 };
  const rumors = Object.values(row?.data?.rumors || {})
    .map(({ outlets, ...r }) => ({ ...r, sources: r.sources.slice(0, 8) }))
    .sort((a, b) => order[a.status] - order[b.status] || (b.player ? 1 : 0) - (a.player ? 1 : 0) || b.mentions - a.mentions || b.last_updated.localeCompare(a.last_updated));
  return { rumors, deadline: deadline(), source: 'ProFootballRumors + Google News trade queries + AFI news feed; keyword-classified', last_updated: row?.updated_at || null };
}

module.exports = { refreshTrades, refreshRumors, getTrades, getRumors, deadline, transactions, clauses, parseAssets, parseTradeClause, classify, teamResolver };
