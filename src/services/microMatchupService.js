const db = require('../db/database');
const { assetUrl, streamCsv, assetExists, loadIdMap, num } = require('./nflverseService');

// Free nflverse PBP + participation only.  Participation does not establish
// shadow assignments, so coverage signals never claim WR-vs-CB coverage.
//
// Players are keyed by nflverse gsis_id (passer/receiver/rusher_player_id) and
// joined to ESPN depth-chart starters through nflverse's players.csv espn_id,
// never by name: two "J.Daniels" on different teams must not share a split.
//
// Pressure uses one definition for every season: QB hit or sack per dropback
// (a pressure proxy).  The 2026 participation file is not published, so FTN's
// was_pressure would otherwise mean different things in different seasons.
// Coverage (man/zone) and 5+ rusher (blitz) rates come from the most recent
// participation release only and are labelled with that season.
const VERSION = 2;
const TTL_MS = 6 * 3600e3;
const BACKOFF_MS = 30 * 60e3;
const MAX_TOTAL = 2; // the summed adjustment per game is capped until the signals are backtested
const n = (v) => Number(v) || 0;
const rate = (a, b) => b ? a / b : 0;
const one = (v) => Math.round(v * 10) / 10;
const pct = (v) => one(v * 100);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const key = (game, play) => `${game}|${play}`;
const make = (icon, label, text, impact, sample, team) => ({ icon, label, text, impact: one(clamp(impact, -2, 2)), sample, team });
const bucket = () => ({ n: 0, epa: 0 });
const cov = (v) => /man/i.test(v || '') ? 'man' : /zone/i.test(v || '') ? 'zone' : null;
const TEAM = { LA: 'LAR', WAS: 'WSH' }; // nflverse -> ESPN abbreviations
const team = (t) => TEAM[t] || t;
const indoor = (roof) => /dome|closed|covered|retractable/i.test(roof || '');
const PBP = ['game_id', 'play_id', 'home_team', 'away_team', 'posteam', 'defteam', 'play_type', 'pass', 'rush', 'qb_dropback', 'sack', 'qb_hit', 'epa', 'yards_gained', 'rusher_player_id', 'rusher_player_name', 'passer_player_id', 'passer_player_name', 'receiver_player_id', 'receiver_player_name', 'total_home_score', 'total_away_score', 'home_score', 'away_score', 'temp', 'wind', 'roof', 'start_time'];
const PART = ['nflverse_game_id', 'play_id', 'defense_man_zone_type', 'defense_coverage_type', 'number_of_pass_rushers'];

// nflverse start_time is the Eastern kickoff clock, e.g. "9/7/25, 20:22:52".
const etHour = (startTime) => { const m = /,\s*(\d{1,2}):/.exec(startTime || ''); return m ? Number(m[1]) : null; };
const isNight = (hour) => hour != null && hour >= 19;
const kickoffEtHour = (date) => {
  const t = Date.parse(date || ''); if (!t) return null;
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)));
};

async function build(season) {
  const participation = new Map();
  let chartedSeason = null;
  for (const yr of [season - 1, season]) {
    // Participation releases are plain CSV (not gzip) and lag the live PBP feed.
    const file = `pbp_participation_${yr}.csv`;
    if (!(await assetExists('pbp_participation', file))) continue;
    chartedSeason = yr;
    await streamCsv(assetUrl('pbp_participation', file), (r) => {
      if (!r.nflverse_game_id || r.play_id == null) return;
      participation.set(key(r.nflverse_game_id, r.play_id), { rushers: n(r.number_of_pass_rushers), coverage: cov(r.defense_man_zone_type) || cov(r.defense_coverage_type) });
    }, { columns: PART });
  }
  const games = new Map(), rush = new Map();
  const data = { version: VERSION, season, charted_season: chartedSeason, def: {}, off: {}, qbs: {}, targets: {}, league: { drop: 0, pressure: 0, pressured: bucket(), clean: bucket() } };
  const inc = (x, f, epa) => { x[f].n++; x[f].epa += epa; };
  const addPass = (p) => {
    if (!(p.qb_dropback === '1' || p.pass === '1' || p.sack === '1') || !p.posteam || !p.defteam) return;
    const x = participation.get(key(p.game_id, p.play_id)) || {};
    const off = team(p.posteam), def = team(p.defteam);
    const pressured = p.qb_hit === '1' || p.sack === '1';
    const blitz = x.rushers >= 5;
    const d = data.def[def] ||= { drop: 0, pressure: 0, coverage: 0, man: 0, charted: 0, blitz: 0 };
    const o = data.off[off] ||= { drop: 0, pressure: 0 };
    const epa = n(p.epa);
    d.drop++; o.drop++; data.league.drop++;
    if (pressured) { d.pressure++; o.pressure++; data.league.pressure++; }
    inc(data.league, pressured ? 'pressured' : 'clean', epa);
    if (x.coverage !== undefined) { d.charted++; if (blitz) d.blitz++; if (x.coverage) { d.coverage++; if (x.coverage === 'man') d.man++; } }
    if (p.passer_player_id) {
      const q = data.qbs[p.passer_player_id] ||= { name: p.passer_player_name, pressured: bucket(), clean: bucket(), man: bucket(), manOther: bucket(), blitz: bucket(), blitzOther: bucket(), cold: bucket(), coldOther: bucket(), wind: bucket(), windOther: bucket(), night: bucket(), nightOther: bucket(), all: bucket() };
      inc(q, pressured ? 'pressured' : 'clean', epa); inc(q, 'all', epa);
      if (x.coverage !== undefined) { inc(q, x.coverage === 'man' ? 'man' : 'manOther', epa); inc(q, blitz ? 'blitz' : 'blitzOther', epa); }
      // Missing temperature/wind is unknown, not cold or calm-by-default.
      const temp = num(p.temp), wind = num(p.wind);
      if (!indoor(p.roof) && temp != null) inc(q, temp < 40 ? 'cold' : 'coldOther', epa);
      if (!indoor(p.roof) && wind != null) inc(q, wind > 15 ? 'wind' : 'windOther', epa);
      if (etHour(p.start_time) != null) inc(q, isNight(etHour(p.start_time)) ? 'night' : 'nightOther', epa);
    }
    // Targets are kept per offense, so a receiver's old team never feeds his new team's signal.
    if (p.receiver_player_id && x.coverage) {
      const t = (data.targets[off] ||= {})[p.receiver_player_id] ||= { name: p.receiver_player_name, man: bucket(), zone: bucket() };
      inc(t, x.coverage, epa);
    }
  };
  const add = (p) => {
    if (!p.game_id || !p.home_team || !p.away_team) return;
    games.set(p.game_id, { home: team(p.home_team), away: team(p.away_team), hs: Math.max(n(p.total_home_score), n(p.home_score)), as: Math.max(n(p.total_away_score), n(p.away_score)) });
    if (p.play_type === 'run' && p.rush === '1' && p.rusher_player_id && p.posteam) {
      const k = `${p.game_id}|${p.posteam}|${p.rusher_player_id}`;
      const r = rush.get(k) || { game: p.game_id, team: team(p.posteam), player: p.rusher_player_id, yards: 0, carries: 0 };
      r.yards += n(p.yards_gained); r.carries++; rush.set(k, r);
    }
    addPass(p);
  };
  for (const yr of [season - 1, season]) await streamCsv(assetUrl('pbp', `play_by_play_${yr}.csv.gz`), add, { columns: PBP });
  participation.clear();

  const rankBy = (obj, value, desc = true) => Object.entries(obj).sort((a, b) => desc ? value(b[1]) - value(a[1]) : value(a[1]) - value(b[1])).reduce((o, [t], i) => (o[t] = i + 1, o), {});
  Object.values(data.def).forEach((d) => { d.manRate = rate(d.man, d.coverage); d.blitzRate = rate(d.blitz, d.charted); d.pressureRate = rate(d.pressure, d.drop); });
  Object.values(data.off).forEach((o) => { o.pressureRate = rate(o.pressure, o.drop); });
  data.defRank = rankBy(data.def, (d) => d.pressureRate);
  data.olRank = rankBy(data.off, (o) => o.pressureRate, false);
  const charted = Object.fromEntries(Object.entries(data.def).filter(([, d]) => d.charted));
  data.manRank = rankBy(charted, (d) => d.manRate); data.blitzRank = rankBy(charted, (d) => d.blitzRate);
  data.league.pressureRate = rate(data.league.pressure, data.league.drop);
  data.league.split = rate(data.league.pressured.epa, data.league.pressured.n) - rate(data.league.clean.epa, data.league.clean.n);

  // Ties are neither wins nor losses.
  data.rush = [...rush.values()].map((r) => {
    const g = games.get(r.game); if (!g) return null;
    const [us, them] = g.home === r.team ? [g.hs, g.as] : [g.as, g.hs];
    return { team: r.team, player: r.player, yards: r.yards, carries: r.carries, result: us > them ? 'W' : us < them ? 'L' : 'T' };
  }).filter(Boolean);

  // ESPN athlete id -> gsis id, only for players that appear in the aggregates.
  const used = new Set([...Object.keys(data.qbs), ...data.rush.map((r) => r.player), ...Object.values(data.targets).flatMap((t) => Object.keys(t))]);
  const ids = await loadIdMap();
  data.espn = {}; data.position = {};
  Object.values(ids.gsis).forEach((r) => { if (used.has(r.gsis_id)) { data.espn[String(r.espn_id)] = r.gsis_id; data.position[r.gsis_id] = r.position; } });
  data.built_at = new Date().toISOString();
  return data;
}

// Per-season memo with a TTL.  The last good aggregate is persisted so a cold
// start or an nflverse outage serves it instead of silently dropping signals,
// and failed downloads back off instead of retrying on every request.
const memo = {};
const snapshotKey = (season) => `micro_matchups_${season}`;
async function load(season) {
  const s = memo[season] ||= { data: null, loadedAt: 0, failedAt: 0, promise: null };
  if (!s.data && !s.restored) {
    s.restored = true;
    const row = await db.loadDataset(snapshotKey(season)).catch(() => null);
    if (row?.data?.version === VERSION) { s.data = row.data; s.loadedAt = Date.parse(row.data.built_at) || 0; }
  }
  if (s.data && Date.now() - s.loadedAt < TTL_MS) return s.data;
  if (s.failedAt && Date.now() - s.failedAt < BACKOFF_MS) {
    if (s.data) return s.data;
    throw new Error('nflverse unavailable (backing off)');
  }
  if (!s.promise) {
    s.promise = build(season).then(async (data) => {
      s.data = data; s.loadedAt = Date.now(); s.failedAt = 0;
      await db.saveDataset(snapshotKey(season), data, { qbs: Object.keys(data.qbs).length }).catch((e) => console.warn(`[matchups] snapshot save failed: ${e.message}`));
      return data;
    }).catch((e) => {
      s.failedAt = Date.now();
      console.warn(`[matchups] nflverse load failed${s.data ? ', serving last good snapshot' : ''}: ${e.message}`);
      if (s.data) return s.data;
      throw e;
    }).finally(() => { s.promise = null; });
  }
  // Stale data is served while the refresh runs in the background.
  return s.data || s.promise;
}

const gsis = (data, player) => player?.id != null ? data.espn[String(player.id)] : null;
const effect = (diff, scale = 4) => clamp(diff * scale, -1.8, 1.8);
const desc = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`; // EPA values
const seasons = (data) => `${data.season - 1}–${String(data.season).slice(2)}`;

function rbSignal(data, side, team) {
  const id = gsis(data, side?.rb1); if (!id) return null;
  const x = data.rush.filter((r) => r.team === team && r.player === id && r.carries && r.result !== 'T');
  if (x.length < 16 || x.reduce((s, r) => s + r.carries, 0) < 20) return null;
  const threshold = Math.round(x.map((r) => r.yards).sort((a, b) => a - b)[Math.floor(x.length / 2)] / 5) * 5;
  const record = (a) => a.reduce((z, r) => (r.result === 'W' ? z.w++ : z.l++, z), { w: 0, l: 0 });
  const high = record(x.filter((r) => r.yards >= threshold)), low = record(x.filter((r) => r.yards < threshold));
  const hi = rate(high.w, high.w + high.l), lo = rate(low.w, low.w + low.l);
  if (high.w + high.l < 8 || low.w + low.l < 8 || Math.abs(hi - lo) < .25) return null;
  const impact = (hi > lo ? 1 : -1) * clamp(Math.abs(hi - lo) * 1.5, .4, 1.8);
  return make('🏃', 'RB1 team-results threshold', `${team} is ${high.w}-${high.l} when ${side.rb1.name} reaches ${threshold}+ rush yards and ${low.w}-${low.l} when held under—a ${Math.round(Math.abs(hi - lo) * 100)}-point win-rate split (${seasons(data)}, ties excluded). AFI ${impact > 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, x.length, team);
}

function conditionSignal(data, side, team, weather) {
  const id = gsis(data, side?.starting_qb), q = id && data.qbs[id]; if (!q || !weather) return null;
  const f = weather.forecast, outdoors = f && weather.roof && !indoor(weather.roof);
  const hour = kickoffEtHour(weather.date);
  const kind = outdoors && f.temp_f != null && f.temp_f < 40 ? 'cold' : outdoors && f.wind_mph != null && f.wind_mph > 15 ? 'wind' : isNight(hour) ? 'night' : null;
  const other = q[`${kind}Other`];
  if (!kind || q[kind].n < 50 || other.n < 50) return null;
  const a = rate(q[kind].epa, q[kind].n), b = rate(other.epa, other.n); if (Math.abs(a - b) < .08) return null;
  const forecast = kind === 'cold' ? `${Math.round(f.temp_f)}°F forecast` : kind === 'wind' ? `${Math.round(f.wind_mph)} mph forecast wind` : 'night kickoff (7pm ET or later)', impact = effect(a - b);
  return make('🌦️', 'QB condition EPA split', `${side.starting_qb.name}: ${desc(a)} EPA/dropback in ${kind} games vs ${desc(b)} otherwise (${q[kind].n} vs ${other.n} dropbacks; ${forecast}). AFI ${impact >= 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, q[kind].n, team);
}

// Fires only for a real mismatch: a top-8 pass rush against a bottom-11 line.
// The QB's pressured-vs-clean split is compared with the league-average split
// (every QB is worse under pressure), and scaled by how much more often than
// average this rush/line pairing should produce a hit or sack, over a typical
// 35-dropback game (EPA is in points).
const DROPBACKS = 35;
function pressureSignal(data, side, team, opp) {
  const id = gsis(data, side?.starting_qb), q = id && data.qbs[id], d = data.def[opp], o = data.off[team];
  if (!q || !d || !o || q.pressured.n < 50 || q.clean.n < 50) return null;
  const dr = data.defRank[opp], or = data.olRank[team]; if (!(dr <= 8 && or >= 22)) return null;
  const split = rate(q.pressured.epa, q.pressured.n) - rate(q.clean.epa, q.clean.n), excess = split - data.league.split;
  const extra = (d.pressureRate - data.league.pressureRate) + (o.pressureRate - data.league.pressureRate); if (Math.abs(excess) < .1 || extra <= 0) return null;
  const impact = clamp(DROPBACKS * extra * excess, -1.5, 1.5);
  if (Math.abs(impact) < .2) return null;
  return make('💨', 'Pass rush vs. O-line', `${opp} gets a hit or sack on ${pct(d.pressureRate)}% of dropbacks (NFL rank ${dr}; league ${pct(data.league.pressureRate)}%) and ${team}'s line allows ${pct(o.pressureRate)}% (rank ${or}), ${seasons(data)} hits+sacks. ${side.starting_qb.name}'s pressured-vs-clean EPA gap is ${desc(split)} vs the league's ${desc(data.league.split)} (${q.pressured.n}/${q.clean.n} dropbacks). AFI ${impact >= 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, q.pressured.n + q.clean.n, team);
}

function coverageSignal(data, side, team, opp, oppSide) {
  const wr = side?.wr1, id = gsis(data, wr); if (!id || wr.position !== 'WR' || (data.position[id] && data.position[id] !== 'WR')) return null;
  const w = data.targets[team]?.[id], d = data.def[opp]; if (!w || !d || !d.coverage) return null;
  const kind = d.manRate >= .5 ? 'man' : 'zone', other = kind === 'man' ? 'zone' : 'man';
  if (w[kind].n < 30 || w[other].n < 30) return null; const a = rate(w[kind].epa, w[kind].n), b = rate(w[other].epa, w[other].n); if (Math.abs(a - b) < .08) return null;
  const impact = effect(a - b, 3), cb = oppSide?.cb1?.name ? `; top CB by depth-chart snaps: ${oppSide.cb1.name}` : '';
  return make('🎯', 'WR1 vs. coverage', `${wr.name} has ${desc(a)} EPA/target vs ${kind} and ${desc(b)} vs ${other} with ${team}; ${opp} used ${kind} on ${pct(kind === 'man' ? d.manRate : 1 - d.manRate)}% of charted coverage plays (${data.charted_season} charting)${cb}. AFI ${impact >= 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, w[kind].n, team);
}

function schemeSignal(data, side, team, opp) {
  const id = gsis(data, side?.starting_qb), q = id && data.qbs[id], d = data.def[opp]; if (!q || !d || !d.charted) return null;
  const kind = data.manRank[opp] <= 8 || data.manRank[opp] >= 25 ? 'man' : (data.blitzRank[opp] <= 8 || data.blitzRank[opp] >= 25 ? 'blitz' : null); if (!kind) return null;
  const other = `${kind}Other`, a = q[kind], b = q[other]; if (a.n < 50 || b.n < 50) return null; const av = rate(a.epa, a.n), bv = rate(b.epa, b.n); if (Math.abs(av - bv) < .08) return null;
  const rank = kind === 'man' ? data.manRank[opp] : data.blitzRank[opp], share = kind === 'man' ? d.manRate : d.blitzRate, impact = effect(av - bv, 3.5);
  return make('🧭', 'Scheme extreme', `${opp} was NFL rank ${rank} in ${kind === 'blitz' ? '5+ rusher' : kind} rate (${pct(share)}%, ${data.charted_season} charting); ${side.starting_qb.name} is ${desc(av)} EPA/dropback vs ${kind} and ${desc(bv)} otherwise (${a.n}/${b.n}). AFI ${impact >= 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, a.n, team);
}

// Net home-relative adjustment from the shown signals, capped at ±MAX_TOTAL.
const matchupAdjustment = (signals, home, away) => {
  const raw = signals.reduce((t, s) => t + (s.team === home ? s.impact : s.team === away ? -s.impact : 0), 0);
  return { raw: one(raw), capped: one(clamp(raw, -MAX_TOTAL, MAX_TOTAL)) };
};

async function getMicroMatchups({ season, home, away, weather, preview }) {
  const data = await load(season);
  const homeSide = preview?.home, awaySide = preview?.away;
  const rush = [pressureSignal(data, awaySide, away, home), pressureSignal(data, homeSide, home, away)];
  return [
    rbSignal(data, awaySide, away), rbSignal(data, homeSide, home),
    conditionSignal(data, awaySide, away, weather), conditionSignal(data, homeSide, home, weather),
    // A mismatch on both sides is not a mismatch: drop the pair rather than let it cancel.
    ...(rush[0] && rush[1] ? [] : rush),
    coverageSignal(data, awaySide, away, home, homeSide), coverageSignal(data, homeSide, home, away, awaySide),
    schemeSignal(data, awaySide, away, home), schemeSignal(data, homeSide, home, away)
  ].filter(Boolean).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3);
}
module.exports = { getMicroMatchups, matchupAdjustment, MAX_TOTAL };
