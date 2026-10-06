const cache = require('../cache/cacheManager');
const { getScoreboard, getStandings } = require('./sportsDataService');
const { currentSeason } = require('./rosterService');
const { computeStandings, buildRecords } = require('./playoffEngine');

const REG_WEEKS = 18;
const SIMS = 10000;
const HOME_FIELD = 1.5; // points
const SPREAD_SD = 13.5; // std. dev. of NFL final margin around the spread

// --- Win probability model ----------------------------------------------------

// Normal CDF (Abramowitz-Stegun 7.1.26).
const phi = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

const implied = (ml) => (ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100));

// Team strength = scoring margin per game, shrunk toward 0 with 4 phantom 0-margin games.
const powerRatings = (games) => {
  const sum = {}; const n = {};
  games.forEach((g) => {
    if (!g.result || g.home_score == null) return;
    const m = g.home_score - g.away_score;
    sum[g.home] = (sum[g.home] || 0) + m; n[g.home] = (n[g.home] || 0) + 1;
    sum[g.away] = (sum[g.away] || 0) - m; n[g.away] = (n[g.away] || 0) + 1;
  });
  const out = {};
  Object.keys(sum).forEach((id) => { out[id] = sum[id] / (n[id] + 4); });
  return out;
};

// Home win probability: de-vigged moneyline > spread > power-rating spread.
const winProbability = (g, ratings) => {
  const l = g.lines;
  if (l?.moneyline_home != null && l?.moneyline_away != null) {
    const h = implied(l.moneyline_home); const a = implied(l.moneyline_away);
    return { p_home: h / (h + a), source: 'moneyline' };
  }
  if (l?.spread_home != null) return { p_home: phi(-l.spread_home / SPREAD_SD), source: 'spread' };
  const spread = (ratings[g.home] || 0) - (ratings[g.away] || 0) + (g.neutral ? 0 : HOME_FIELD);
  return { p_home: phi(spread / SPREAD_SD), source: 'model', model_spread_home: Math.round(-spread * 2) / 2 };
};

// --- Season data --------------------------------------------------------------

const resultOf = (e) => {
  if (!e.status.completed) return null;
  if (e.home.score > e.away.score) return 'H';
  if (e.away.score > e.home.score) return 'A';
  return 'T';
};

const loadSeason = async (season = currentSeason()) => cache.getOrSet(`playoff_season_${season}`, async () => {
  const [standings, ...weeks] = await Promise.all([
    getStandings(),
    ...Array.from({ length: REG_WEEKS }, (_, i) => getScoreboard({ week: i + 1, season, seasonType: 2 }))
  ]);
  const teams = [];
  standings.conferences.forEach((conf) => conf.divisions.forEach((div) => div.teams.forEach((t) => {
    teams.push({ id: t.id, abbreviation: t.abbreviation, name: t.name, short_name: t.short_name, logo: t.logo, color: t.color, conf: conf.abbreviation, div: div.name });
  })));
  const raw = weeks.flatMap((w) => w.games).filter((e) => e.season_type === 2 || e.season_type == null);
  const seen = new Set();
  const games = raw.filter((e) => !seen.has(e.game_id) && seen.add(e.game_id)).map((e) => ({
    id: e.game_id,
    week: e.week,
    date: e.date,
    home: e.home.id,
    away: e.away.id,
    state: e.status.state,
    result: resultOf(e),
    home_score: e.status.state === 'pre' ? null : e.home.score,
    away_score: e.status.state === 'pre' ? null : e.away.score,
    neutral: e.neutral_site,
    lines: e.lines
  })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const ratings = powerRatings(games);
  games.forEach((g) => { if (!g.result) Object.assign(g, winProbability(g, ratings)); });
  return { season, teams, games, ratings, fetched_at: new Date().toISOString() };
}, 600);

// --- Output shaping -------------------------------------------------------------

const recordLine = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;

const shapeStandings = (data, result) => {
  const byId = Object.fromEntries(data.teams.map((t) => [t.id, t]));
  const teamRow = (id) => {
    const r = result.records[id];
    const sov = r.games.filter((g) => g.res === 1).map((g) => result.records[g.opp]);
    const sumPct = (list) => {
      const w = list.reduce((s, o) => s + o.w + o.t / 2, 0); const n = list.reduce((s, o) => s + o.w + o.l + o.t, 0);
      return n ? Math.round((w / n) * 1000) / 1000 : null;
    };
    return {
      id, abbreviation: byId[id].abbreviation, name: byId[id].name, logo: byId[id].logo,
      record: recordLine(r), pct: Math.round(r.pct * 1000) / 1000,
      division: `${r.dw}-${r.dl}${r.dt ? `-${r.dt}` : ''}`, conference: `${r.cw}-${r.cl}${r.ct ? `-${r.ct}` : ''}`,
      sov: sumPct(sov), sos: sumPct(r.games.map((g) => result.records[g.opp])), net_points: r.pf - r.pa
    };
  };
  const conferences = {};
  Object.entries(result.conferences).forEach(([conf, c]) => {
    const seeds = c.seeds.map((id, i) => ({ seed: i + 1, ...teamRow(id), division_winner: i < 4 }));
    conferences[conf] = {
      seeds,
      hunt: c.order.slice(7).map((id) => teamRow(id)),
      // Wild card round: 2v7, 3v6, 4v5; #1 seed has a bye. Divisional round re-seeds (1 hosts lowest remaining seed).
      wild_card_round: [[2, 7], [3, 6], [4, 5]].map(([h, a]) => ({ home: seeds[h - 1], away: seeds[a - 1] })),
      bye: seeds[0]
    };
  });
  const divisions = Object.entries(result.divisions).map(([name, ids]) => ({ name, conf: byId[ids[0]].conf, teams: ids.map(teamRow) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { conferences, divisions };
};

// Standings for actual results plus user picks ({ gameId: 'H' | 'A' | 'T' }) on undecided games.
const scenario = async (picks = {}, season) => {
  const data = await loadSeason(season);
  let picked = 0;
  const games = data.games.map((g) => {
    if (g.result || !['H', 'A', 'T'].includes(picks[g.id])) return g;
    picked += 1;
    return { ...g, result: picks[g.id], home_score: null, away_score: null };
  });
  const remaining = data.games.filter((g) => !g.result).length;
  return { season: data.season, picked, unpicked: remaining - picked, ...shapeStandings(data, computeStandings(data.teams, games)) };
};

// --- Monte Carlo ------------------------------------------------------------------

const simulate = (data, sims = SIMS) => {
  const open = data.games.filter((g) => !g.result);
  const fixed = data.games.filter((g) => g.result);
  const counts = {};
  data.teams.forEach((t) => { counts[t.id] = { playoffs: 0, division: 0, seed1: 0, seeds: Array(7).fill(0), wins: 0 }; });
  const games = [...fixed, ...open.map((g) => ({ ...g }))];
  const openSlots = games.slice(fixed.length);
  for (let s = 0; s < sims; s += 1) {
    openSlots.forEach((g) => { g.result = Math.random() < g.p_home ? 'H' : 'A'; });
    const res = computeStandings(data.teams, games);
    Object.values(res.conferences).forEach((c) => c.seeds.forEach((id, i) => {
      const k = counts[id];
      k.playoffs += 1; k.seeds[i] += 1;
      if (i < 4) k.division += 1;
      if (i === 0) k.seed1 += 1;
    }));
    Object.values(res.records).forEach((r) => { counts[r.id].wins += r.w + r.t / 2; });
  }
  const pctOf = (n) => Math.round((1000 * n) / sims) / 10;
  const byId = Object.fromEntries(data.teams.map((t) => [t.id, t]));
  const current = buildRecords(data.teams, fixed);
  return data.teams.map((t) => ({
    id: t.id, abbreviation: t.abbreviation, name: t.name, short_name: t.short_name, logo: t.logo, conf: t.conf, div: byId[t.id].div,
    record: recordLine(current[t.id]),
    projected_wins: Math.round((counts[t.id].wins / sims) * 10) / 10,
    make_playoffs: pctOf(counts[t.id].playoffs),
    win_division: pctOf(counts[t.id].division),
    first_seed: pctOf(counts[t.id].seed1),
    seeds: counts[t.id].seeds.map(pctOf),
    power_rating: data.ratings[t.id] != null ? Math.round(data.ratings[t.id] * 10) / 10 : 0
  })).sort((a, b) => b.make_playoffs - a.make_playoffs || b.projected_wins - a.projected_wins);
};

const getOdds = async (season = currentSeason()) => {
  const data = await loadSeason(season);
  const decided = data.games.filter((g) => g.result).length;
  // Re-simulate when results change (keyed by completed game count) or after 30 minutes (line moves).
  return cache.getOrSet(`playoff_odds_${season}_${decided}`, async () => {
    const started = Date.now();
    const teams = simulate(data);
    return { season, sims: SIMS, decided_games: decided, remaining_games: data.games.length - decided, teams, duration_ms: Date.now() - started, computed_at: new Date().toISOString() };
  }, 1800);
};

const getOverview = async (season = currentSeason()) => {
  const data = await loadSeason(season);
  const actual = computeStandings(data.teams, data.games);
  const byId = Object.fromEntries(data.teams.map((t) => [t.id, t]));
  return {
    season: data.season,
    teams: data.teams,
    games: data.games.map((g) => ({
      ...g,
      home_abbr: byId[g.home]?.abbreviation, away_abbr: byId[g.away]?.abbreviation,
      p_home: g.p_home != null ? Math.round(g.p_home * 1000) / 1000 : undefined
    })),
    current: shapeStandings(data, actual),
    model: {
      win_probability: 'De-vigged ESPN/DraftKings moneyline when posted; else point spread (normal, sd 13.5); else power-rating spread (margin per game shrunk by 4 games, +1.5 home field).',
      tiebreakers: 'Division: H2H, division, common, conference, SOV, SOS, net points, coin toss. Wild card: division reduction, H2H (sweep rule for 3+), conference, common (min 4), SOV, SOS, net points, coin toss. Skipped: points-ranking steps, net points in common/conference games, net TDs; coin toss is deterministic.'
    },
    last_updated: data.fetched_at
  };
};

module.exports = { getOverview, getOdds, scenario, loadSeason, winProbability, powerRatings, phi };
