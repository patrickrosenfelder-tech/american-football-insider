const crypto = require('crypto');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const db = require('../db/database');
const { ESPN_SITE, fetchJson, getTeams, getScoreboard } = require('./sportsDataService');
const { getRoster } = require('./rosterService');
const injuryService = require('./injuryService');
const llm = require('./llmService');

// In-site news. We never republish articles: headlines from public feeds are grouped into stories, each
// story gets our own short summary (LLM, from the headline + feed snippet only) and links to every source.
// Data stories (game recaps, injury updates, roster moves) are written by us from structured data.

const DATASET = 'news_v1';
const DAILY_LLM_CAP = Number(process.env.NEWS_DAILY_LLM_CAP || 150); // stories/day
const RUN_LLM_CAP = Number(process.env.NEWS_RUN_LLM_CAP || 40); // stories/run
const BATCH = 5; // stories per LLM request
const KEEP_DAYS = 7;
const MAX_AGE_HOURS = 96; // ignore feed items older than this

const RSS_FEEDS = [
  { name: 'ESPN', url: 'https://www.espn.com/espn/rss/nfl/news' },
  { name: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/nfl/' },
  { name: 'Yahoo Sports', url: 'https://sports.yahoo.com/nfl/rss.xml' },
  { name: 'ProFootballTalk', url: 'https://profootballtalk.nbcsports.com/feed/' }
];

// Not news: fantasy/betting columns, rankings, video shows.
const SKIP = /promo code|bonus code|bonus bets|sportsbook|fantasy|rankings?\b|start[/ -]sit|\bdfs\b|best bets?|\bparlay|\bprops?\b|betting|odds\b|mock draft|podcast|\bwatch:|livestream|how to watch|power rankings/i;

const http = axios.create({ timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; American-Football-Insider/1.0; +https://american-football-insider.fly.dev)' } });
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’')
  .replace(/&#8216;|&lsquo;/g, '‘').replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&#\d+;/g, ' ')
  .replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
const canonicalUrl = (u) => String(u || '').split('#')[0].replace(/\?.*$/, '').replace(/\/$/, '');

// --- Sources -------------------------------------------------------------------

const fetchEspnNews = async () => {
  const data = await fetchJson(`${ESPN_SITE}/news`, { limit: 75 });
  return (data.articles || []).filter((a) => !(a.categories || []).some((c) => /fantasy/i.test(c.description || ''))).map((a) => ({
    source: 'ESPN',
    title: stripHtml(a.headline),
    description: clip(stripHtml(a.description), 400),
    url: a.links?.web?.href,
    published: a.published || a.lastModified,
    espn_team_ids: (a.categories || []).filter((c) => c.type === 'team' && c.teamId).map((c) => String(c.teamId)),
    espn_athletes: (a.categories || []).filter((c) => c.type === 'athlete' && c.athleteId).map((c) => ({ id: String(c.athleteId), name: c.description }))
  }));
};

const fetchRss = async (feed) => {
  const { data } = await http.get(feed.url, { responseType: 'text' });
  const doc = xml.parse(data);
  const items = [].concat(doc?.rss?.channel?.item || doc?.feed?.entry || []);
  return items.map((it) => ({
    source: feed.name,
    title: stripHtml(it.title?.['#text'] ?? it.title),
    description: clip(stripHtml(it.description?.['#text'] ?? it.description ?? it.summary ?? ''), 400),
    url: typeof it.link === 'string' ? it.link : it.link?.href || it.guid?.['#text'] || it.guid,
    published: it.pubDate || it.published || it.updated || null,
    espn_team_ids: [],
    espn_athletes: []
  }));
};

const fetchAllSources = async () => {
  const fetched = {};
  const errors = {};
  const jobs = [{ name: 'ESPN API', run: fetchEspnNews }, ...RSS_FEEDS.map((f) => ({ name: `${f.name} RSS`, run: () => fetchRss(f) }))];
  const results = await Promise.all(jobs.map(async (j) => {
    try {
      const items = await j.run();
      fetched[j.name] = items.length;
      return items;
    } catch (error) {
      errors[j.name] = error.response ? `HTTP ${error.response.status}` : error.message;
      return [];
    }
  }));
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600e3;
  const seen = new Set();
  const items = results.flat().filter((i) => {
    if (!i.title || !i.url || SKIP.test(i.title)) return false;
    const t = Date.parse(i.published);
    if (Number.isNaN(t) || t < cutoff) return false;
    i.published = new Date(t).toISOString();
    i.url_key = canonicalUrl(i.url);
    if (seen.has(i.url_key)) return false;
    seen.add(i.url_key);
    return true;
  });
  return { items, fetched, errors };
};

// --- Tagging -------------------------------------------------------------------

const buildIndex = async () => {
  const teams = await getTeams();
  const teamAliases = [];
  teams.forEach((t) => {
    [t.name, t.short_name].filter(Boolean).forEach((alias) => teamAliases.push({ re: new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), team: t }));
  });
  const players = new Map(); // normalized full name -> { id, name, team }
  const rosters = await Promise.all(teams.map((t) => getRoster(t.id).catch(() => null)));
  rosters.forEach((r) => r?.groups.forEach((g) => g.positions.forEach((p) => p.athletes.forEach((a) => {
    if (a.name && a.name.includes(' ')) players.set(a.name.toLowerCase(), { id: String(a.id), name: a.name, team: r.team.abbreviation, position: a.position });
  }))));
  return { teams, byId: Object.fromEntries(teams.map((t) => [t.id, t])), byAbbr: Object.fromEntries(teams.map((t) => [t.abbreviation, t])), teamAliases, players };
};

// Player names: two or three capitalised words; matched against all 32 active rosters.
const NAME_RE = /\b([A-Z][a-zA-Z.'’-]+(?:\s(?:[A-Z][a-zA-Z.'’-]+|St\.|Jr\.|Sr\.|II|III|IV)){1,2})\b/g;

const tagItem = (item, index) => {
  const text = `${item.title}. ${item.description}`;
  const teams = new Set(item.espn_team_ids.map((id) => index.byId[id]?.abbreviation).filter(Boolean));
  index.teamAliases.forEach(({ re, team }) => { if (re.test(text)) teams.add(team.abbreviation); });
  const players = new Map(item.espn_athletes.filter((a) => index.players.has(a.name.toLowerCase())).map((a) => [a.id, { id: a.id, name: a.name }]));
  for (const m of text.matchAll(NAME_RE)) {
    const p = index.players.get(m[1].toLowerCase().replace(/’/g, "'"));
    if (p) { players.set(p.id, { id: p.id, name: p.name }); teams.add(p.team); }
  }
  item.teams = [...teams];
  item.players = [...players.values()];
  return item;
};

// --- Duplicate grouping -----------------------------------------------------------

const STOP = new Set('a an the and or of to in on for with at by from as is are was were be after before over vs his her their its into about up out new says say report reportedly source sources nfl week'.split(' '));
const tokens = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a, b) => {
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter += 1; });
  return inter / (a.size + b.size - inter || 1);
};

// Capitalised name pairs in a headline that aren't team names ("Robert Henry", "Lane Johnson").
const headlineNames = (item, index) => {
  const names = new Set();
  for (const m of item.title.matchAll(NAME_RE)) {
    const n = m[1].toLowerCase();
    if (!index.teamAliases.some(({ re }) => re.test(m[1]))) names.add(n);
  }
  return names;
};

const sameStory = (a, b) => {
  const hours = Math.abs(Date.parse(a.published) - Date.parse(b.published)) / 3600e3;
  if (hours > 48) return false;
  // Formulaic headlines ("X signs RB A off practice squad") about different people are different stories.
  if (a.names.size && b.names.size && ![...a.names].some((n) => b.names.has(n))) return false;
  const sim = jaccard(a.tok, b.tok);
  const sharedPlayer = a.players.some((p) => b.players.some((q) => q.id === p.id));
  return sim >= 0.45 || (sharedPlayer && sim >= 0.2);
};

const cluster = (items, index) => {
  items.forEach((i) => { i.tok = tokens(i.title); i.names = headlineNames(i, index); });
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (sameStory(items[i], items[j])) parent[find(i)] = find(j);
    }
  }
  const groups = {};
  items.forEach((it, i) => { (groups[find(i)] ||= []).push(it); });
  return Object.values(groups);
};

const sourceOf = (i) => ({ name: i.source, title: i.title, url: i.url, published: i.published });

// --- Data stories (written from our own data) --------------------------------------

const ordinalDate = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

const recapStories = async () => {
  const current = await getScoreboard();
  const boards = [current];
  if (current.week > 1) boards.push(await getScoreboard({ week: current.week - 1, season: current.season, seasonType: current.season_type }).catch(() => null));
  return boards.filter(Boolean).flatMap((b) => b.games).filter((g) => g.status.completed).map((g) => {
    const tie = g.home.score === g.away.score;
    const [w, l] = g.home.score >= g.away.score ? [g.home, g.away] : [g.away, g.home];
    const wHome = w.id === g.home.id;
    const margin = w.score - l.score;
    const verb = tie ? 'tied' : margin >= 17 ? 'routed' : margin <= 3 ? 'edged' : 'beat';
    const title = tie ? `${g.away.short_name} and ${g.home.short_name} tie ${g.away.score}-${g.home.score}` : `${w.short_name} ${verb} ${l.short_name} ${w.score}-${l.score}`;
    const body = [];
    body.push(tie
      ? `The ${g.away.name} and ${g.home.name} played to a ${g.away.score}-${g.home.score} tie${g.venue?.name ? ` at ${g.venue.name}` : ''} on ${ordinalDate(g.date)}.`
      : `The ${w.name} ${verb} the ${l.name} ${w.score}-${l.score} ${wHome ? 'at home' : 'on the road'}${g.venue?.name ? ` at ${g.venue.name}` : ''} on ${ordinalDate(g.date)}.`);
    if (w.linescores.length && l.linescores.length) {
      const q = (t) => t.linescores.map((v, i) => `${i < 4 ? `Q${i + 1}` : 'OT'} ${v}`).join(', ');
      body.push(`Scoring by quarter — ${w.abbreviation}: ${q(w)}; ${l.abbreviation}: ${q(l)}.`);
    }
    const leaders = g.leaders.map((x) => `${x.category}: ${x.athlete} (${x.value})`);
    if (leaders.length) body.push(`Game leaders — ${leaders.join('; ')}.`);
    if (w.record || l.record) body.push(`Records after the game: ${w.short_name} ${w.record || '–'}, ${l.short_name} ${l.record || '–'}.`);
    return {
      id: `recap-${g.game_id}`,
      kind: 'data',
      type: 'Game recap',
      title,
      body,
      teams: [g.away.abbreviation, g.home.abbreviation],
      players: [],
      game_id: g.game_id,
      published: g.date,
      sources: [{ name: 'ESPN box score', title: g.name, url: `https://www.espn.com/nfl/game/_/gameId/${g.game_id}` }]
    };
  });
};

// Injury changes since the previous run (new designation, status change, or removed from the report).
// One story per team per day; later changes the same day are appended to it.
const injuryChanges = async (state) => {
  const report = await injuryService.getLeagueInjuries();
  const prev = state.injury_snapshot || null;
  const snapshot = {};
  const firstRun = !prev;
  const recent = Date.now() - 24 * 3600e3;
  const today = etDate();
  let changed = 0;
  report.teams.forEach(({ team, injuries }) => {
    const changes = [];
    const onReport = new Set();
    injuries.forEach((i) => {
      if (!i.athlete_id) return;
      onReport.add(i.athlete_id);
      snapshot[i.athlete_id] = { status: i.status, name: i.name, position: i.position, team: team.abbreviation };
      const before = prev?.[i.athlete_id];
      const isNew = firstRun ? (i.updated && Date.parse(i.updated) >= recent) : !before || before.status !== i.status;
      if (!isNew) return;
      const detail = `${i.injury ? `, ${i.injury}` : ''}${i.return_date ? `; estimated return ${i.return_date}` : ''}`;
      changes.push({
        player: { id: i.athlete_id, name: i.name },
        text: before && !firstRun ? `${i.position || ''} ${i.name}: ${before.status} → ${i.status}${detail}`.trim() : `${i.position || ''} ${i.name}: listed ${i.status}${detail}`.trim()
      });
    });
    if (prev) {
      Object.entries(prev).forEach(([id, p]) => {
        if (p.team === team.abbreviation && !onReport.has(id)) changes.push({ player: { id, name: p.name }, text: `${p.position || ''} ${p.name}: no longer on the injury report (was ${p.status})`.trim() });
      });
    }
    if (!changes.length) return;
    changed += changes.length;
    const id = `inj-${team.abbreviation}-${today}`;
    const story = state.stories[id] || (state.stories[id] = {
      id, kind: 'data', type: 'Injury update', persist: true, title: '', body: [], list: [], teams: [team.abbreviation], players: [],
      sources: [{ name: 'ESPN injury report', title: `${team.name} injuries`, url: `https://www.espn.com/nfl/team/injuries/_/name/${team.abbreviation.toLowerCase()}` }]
    });
    changes.forEach((c) => {
      story.list = story.list.filter((x) => x.player?.id !== c.player.id);
      story.list.push(c);
      if (!story.players.some((q) => q.id === c.player.id)) story.players.push(c.player);
    });
    const lead = story.list[0];
    story.title = story.list.length === 1 ? `${team.name} injury update: ${lead.text}` : `${team.name} injury report: ${story.list.length} changes`;
    story.body = [`Changes to the ${team.name} injury report on ${ordinalDate(new Date().toISOString())}, compared with our previous check of ESPN's injury feed:`];
    story.published = new Date().toISOString();
  });
  state.injury_snapshot = snapshot;
  return changed;
};

const transactionStories = async (index) => {
  const data = await fetchJson(`${ESPN_SITE}/transactions`, { limit: 100 });
  const cutoff = Date.now() - 72 * 3600e3;
  const groups = {};
  (data.transactions || []).forEach((t) => {
    if (!t.date || Date.parse(t.date) < cutoff || !t.team?.abbreviation) return;
    const day = new Date(Date.parse(t.date)).toISOString().slice(0, 10);
    (groups[`${t.team.abbreviation}|${day}`] ||= { team: t.team, day, moves: [] }).moves.push(t.description);
  });
  return Object.values(groups).map(({ team, day, moves }) => {
    const players = [];
    moves.forEach((m) => {
      for (const x of m.matchAll(NAME_RE)) {
        const p = index.players.get(x[1].toLowerCase());
        if (p && !players.some((q) => q.id === p.id)) players.push({ id: p.id, name: p.name });
      }
    });
    return {
      id: `tx-${team.abbreviation}-${day}`,
      kind: 'data',
      type: 'Roster moves',
      title: `${team.displayName} roster moves: ${moves.length === 1 ? moves[0].replace(/\.$/, '') : `${moves.length} transactions`}`,
      body: [`The ${team.displayName} made ${moves.length} roster move${moves.length > 1 ? 's' : ''} on ${ordinalDate(`${day}T16:00:00Z`)}:`],
      list: moves.map((m) => ({ text: m })),
      teams: [team.abbreviation],
      players,
      published: `${day}T16:00:00.000Z`,
      sources: [{ name: 'ESPN transactions', title: 'NFL transactions', url: 'https://www.espn.com/nfl/transactions' }]
    };
  });
};

// --- LLM summaries -----------------------------------------------------------------

const PROMPT_HEAD = `You write short news summaries for an NFL website. For EACH story below, using ONLY the facts in its source snippets:
- "title": a neutral headline in your own words (max 12 words).
- "summary": 3-6 factual sentences in your own words. Merge the duplicate sources into one account. Do not invent details, numbers, dates, days of the week, injury designations, attributions ("according to...") or quotes that are not in the snippets; if the snippets are thin, write 3 short sentences. Do not copy sentences from the snippets. At most one direct quote, and only if it is shorter than one short sentence.
- "teams": NFL team abbreviations involved (e.g. KC, PHI, LAR, WSH).
- "players": full names of NFL players or coaches mentioned.
Return JSON only: {"stories":[{"id":"...","title":"...","summary":"...","teams":["..."],"players":["..."]}]}

STORIES:
`;

const promptFor = (stories) => PROMPT_HEAD + stories.map((s) => JSON.stringify({
  id: s.id,
  sources: s.sources.slice(0, 5).map((x) => ({ outlet: x.name, headline: x.title, snippet: x.snippet || '' }))
})).join('\n');

const sentences = (s) => (s.match(/[^.!?]+[.!?]+(\s|$)/g) || []).length;
const longQuote = (s) => (s.match(/["“][^"”]+["”]/g) || []).some((q) => q.split(/\s+/).length > 15);

const validateBatch = (ids) => (json) => {
  const list = Array.isArray(json?.stories) ? json.stories : null;
  if (!list) throw new Error('missing stories[]');
  const good = list.filter((x) => ids.includes(String(x.id)) && typeof x.summary === 'string'
    && sentences(x.summary) >= 2 && sentences(x.summary) <= 7 && x.summary.length <= 1400 && !longQuote(x.summary));
  if (!good.length) throw new Error('no valid summaries');
  return good;
};

const summarize = async (candidates, index, log) => {
  const session = llm.createSession();
  let done = 0;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const res = await session.complete(promptFor(batch), validateBatch(batch.map((s) => s.id)));
    console.log(`[news] batch ${i / BATCH + 1}: ${res ? `${res.provider} (${res.model}) ${res.json.length}/${batch.length}` : 'all providers failed'}`);
    if (!res) break; // every provider failed: keep data stories, retry next run
    res.json.forEach((x) => {
      const story = batch.find((s) => s.id === String(x.id));
      if (!story) return;
      story.ai_title = String(x.title || '').slice(0, 140) || null;
      story.summary = x.summary.trim();
      story.ai = { provider: res.provider, model: res.model, generated_at: new Date().toISOString() };
      (x.teams || []).forEach((abbr) => { const a = String(abbr).toUpperCase(); if (index.byAbbr[a] && !story.teams.includes(a)) story.teams.push(a); });
      (x.players || []).forEach((name) => {
        const p = index.players.get(String(name).toLowerCase());
        if (p && !story.players.some((q) => q.id === p.id || q.name === p.name)) story.players.push({ id: p.id, name: p.name });
      });
      done += 1;
    });
  }
  log.llm = session.summary();
  return done;
};

// --- Run ---------------------------------------------------------------------------

let memo = null;
const load = async () => {
  if (memo) return memo;
  const row = await db.loadDataset(DATASET);
  memo = row?.data || { stories: {}, daily: {}, runs: [] };
  return memo;
};

const etDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const runNews = async ({ summarizeStories = true } = {}) => {
  const state = await load();
  const log = { started_at: new Date().toISOString(), missing_keys: llm.missingKeys() };
  const index = await buildIndex();

  // 1. Headlines -> tagged items -> groups -> merged into stored stories.
  const { items, fetched, errors } = await fetchAllSources();
  log.fetched = fetched;
  if (Object.keys(errors).length) log.source_errors = errors;
  items.forEach((i) => tagItem(i, index));
  const groups = cluster(items, index);
  const byUrl = {};
  Object.values(state.stories).forEach((s) => { if (s.kind === 'headline') s.sources.forEach((x) => { byUrl[canonicalUrl(x.url)] = s; }); });
  let created = 0;
  groups.forEach((g) => {
    g.sort((a, b) => a.published.localeCompare(b.published));
    const existing = g.map((i) => byUrl[i.url_key]).find(Boolean);
    const story = existing || {
      id: hash(g[0].url_key), kind: 'headline', type: 'News', title: g[0].title, summary: null, ai: null,
      teams: [], players: [], sources: [], first_seen: new Date().toISOString()
    };
    if (!existing) { state.stories[story.id] = story; created += 1; }
    g.forEach((i) => {
      if (!story.sources.some((x) => canonicalUrl(x.url) === i.url_key)) story.sources.push({ ...sourceOf(i), snippet: i.description });
      i.teams.forEach((t) => { if (!story.teams.includes(t)) story.teams.push(t); });
      i.players.forEach((p) => { if (!story.players.some((q) => q.id === p.id || q.name === p.name)) story.players.push(p); });
    });
    story.published = story.sources.map((x) => x.published).sort().pop();
  });
  log.items = items.length;
  log.groups = groups.length;
  log.new_stories = created;

  // 2. Data stories (rebuilt every run).
  const dataStories = [];
  const dataJobs = [['recaps', () => recapStories()], ['transactions', () => transactionStories(index)]];
  log.data_stories = {};
  for (const [name, fn] of dataJobs) {
    try {
      const list = await fn();
      dataStories.push(...list);
      log.data_stories[name] = list.length;
    } catch (error) {
      log.data_stories[name] = `error: ${error.message}`;
    }
  }
  Object.keys(state.stories).forEach((id) => { if (state.stories[id].kind === 'data' && !state.stories[id].persist) delete state.stories[id]; });
  dataStories.forEach((s) => { state.stories[s.id] = s; });
  try {
    log.data_stories.injury_changes = await injuryChanges(state);
  } catch (error) {
    log.data_stories.injury_changes = `error: ${error.message}`;
  }

  // 3. Retention.
  const keepAfter = Date.now() - KEEP_DAYS * 24 * 3600e3;
  Object.keys(state.stories).forEach((id) => { if (Date.parse(state.stories[id].published) < keepAfter) delete state.stories[id]; });

  // 4. LLM summaries for unsummarised headline stories, most-covered + newest first, within the daily cap.
  const today = etDate();
  state.daily = { [today]: state.daily?.[today] || 0 };
  const budget = Math.max(0, Math.min(RUN_LLM_CAP, DAILY_LLM_CAP - state.daily[today]));
  const candidates = Object.values(state.stories)
    .filter((s) => s.kind === 'headline' && !s.summary)
    .sort((a, b) => b.sources.length - a.sources.length || b.published.localeCompare(a.published))
    .slice(0, budget);
  log.summary_candidates = candidates.length;
  log.summarized = 0;
  if (summarizeStories && candidates.length && log.missing_keys.length < llm.PROVIDERS.length) {
    log.summarized = await summarize(candidates, index, log);
    state.daily[today] += log.summarized;
  } else if (log.missing_keys.length === llm.PROVIDERS.length) {
    log.llm = { skipped: 'no LLM keys configured' };
  }
  log.summarized_today = state.daily[today];
  log.unsummarized = Object.values(state.stories).filter((s) => s.kind === 'headline' && !s.summary).length;
  log.finished_at = new Date().toISOString();

  state.runs = [log, ...(state.runs || [])].slice(0, 10);
  state.updated_at = log.finished_at;
  await db.saveDataset(DATASET, state, { stories: Object.keys(state.stories).length });
  memo = state;
  const used = (log.llm?.providers || []).map((p) => `${p.name}=${p.used}`).join(' ');
  console.log(`[news] run done: ${items.length} items, ${created} new stories, ${dataStories.length} data stories, summarized ${log.summarized} (${used || 'llm skipped'})`);
  return log;
};

// --- Read API --------------------------------------------------------------------

const teaser = (s) => ({
  id: s.id,
  kind: s.kind,
  type: s.type,
  title: s.ai_title || s.title,
  excerpt: s.summary ? clip(s.summary, 220) : s.list?.length ? clip(s.list.map((x) => x.text).join(' · '), 220) : s.body ? clip(s.body.join(' '), 220) : null,
  teams: s.teams,
  published: s.published,
  source_count: s.sources.length,
  ai: s.ai ? { provider: s.ai.provider } : null
});

const list = async ({ team = null, limit = 60, kind = null } = {}) => {
  const state = await load();
  // team may be a comma list (matchup news): stories tagging both teams sort first.
  const want = team ? String(team).toUpperCase().split(',').filter(Boolean) : [];
  const hits = (s) => want.filter((t) => s.teams.includes(t)).length;
  const stories = Object.values(state.stories)
    .filter((s) => (!want.length || hits(s) > 0) && (!kind || s.kind === kind))
    .sort((a, b) => hits(b) - hits(a) || b.published.localeCompare(a.published));
  // Readable stories (AI summary or data story) first; unsummarised headlines listed separately.
  const readable = stories.filter((s) => s.kind === 'data' || s.summary).slice(0, limit).map(teaser);
  const headlines = stories.filter((s) => s.kind === 'headline' && !s.summary).slice(0, 30)
    .map((s) => ({ id: s.id, title: s.title, published: s.published, teams: s.teams, sources: s.sources.map(({ name, url }) => ({ name, url })) }));
  return { stories: readable, headlines, last_updated: state.updated_at || null, last_run: state.runs?.[0] || null };
};

const get = async (id) => {
  const state = await load();
  const s = state.stories[id];
  if (!s) return null;
  const teams = await getTeams();
  const byAbbr = Object.fromEntries(teams.map((t) => [t.abbreviation, t]));
  return {
    ...s,
    title: s.ai_title || s.title,
    original_title: s.ai_title ? s.title : undefined,
    sources: s.sources.map(({ name, title, url, published }) => ({ name, title, url, published })),
    teams: s.teams.map((a) => ({ abbreviation: a, name: byAbbr[a]?.name || a, logo: byAbbr[a]?.logo || null })),
    ai_note: s.ai ? 'Summary generated by AI from linked sources.' : null,
    related: Object.values(state.stories)
      .filter((o) => o.id !== s.id && o.teams.some((t) => s.teams.includes(t)) && (o.summary || o.kind === 'data'))
      .sort((a, b) => b.published.localeCompare(a.published)).slice(0, 5).map(teaser)
  };
};

const status = async () => {
  const state = await load();
  return { llm: llm.configured(), missing_keys: llm.missingKeys(), daily_cap: DAILY_LLM_CAP, summarized_today: state.daily?.[etDate()] || 0, runs: state.runs || [], stories: Object.keys(state.stories).length, last_updated: state.updated_at || null };
};

module.exports = { runNews, list, get, status, cluster, tokens, jaccard };
