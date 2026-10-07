const { assetUrl, streamCsv, assetExists } = require('./nflverseService');

// Free nflverse PBP + participation only.  Participation does not establish
// shadow assignments, so coverage signals never claim WR-vs-CB coverage.
const n = (v) => Number(v) || 0;
const rate = (a, b) => b ? a / b : 0;
const one = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const key = (game, play) => `${game}|${play}`;
const nameKey = (name) => { const x = String(name || '').replace(/[^a-zA-Z. ]/g, '').trim().split(/[ .]+/).filter(Boolean); return x.length ? `${x[x.length - 1].toLowerCase()}|${x[0][0].toLowerCase()}` : ''; };
const make = (icon, label, text, impact, sample, team) => ({ icon, label, text, impact: one(clamp(impact, -2, 2)), sample, team });
const bucket = () => ({ n: 0, epa: 0 });
const cov = (v) => /man/i.test(v || '') ? 'man' : /zone/i.test(v || '') ? 'zone' : null;
const PBP = ['game_id', 'play_id', 'home_team', 'away_team', 'posteam', 'defteam', 'play_type', 'pass', 'rush', 'qb_dropback', 'sack', 'qb_hit', 'epa', 'yards_gained', 'rusher_player_name', 'passer_player_name', 'receiver_player_name', 'total_home_score', 'total_away_score', 'home_score', 'away_score', 'temp', 'wind', 'roof', 'start_time'];
const PART = ['nflverse_game_id', 'play_id', 'was_target', 'was_pressure', 'was_blitzer', 'was_pass_rusher', 'defense_man_zone_type', 'defense_coverage_type', 'number_of_pass_rushers', 'number_of_blitzers', 'display_name', 'player_name'];
let memo;

async function load(season) {
  if (memo) return memo;
  memo = (async () => {
    const participation = new Map();
    for (const yr of [season - 1, season]) {
      // Participation releases are plain CSV (not gzip) and may lag the live
      // PBP feed.  Keep the most recent published season rather than failing
      // every matchup card when the in-progress season is not released yet.
      const file = `pbp_participation_${yr}.csv`;
      if (!(await assetExists('pbp_participation', file))) continue;
      await streamCsv(assetUrl('pbp_participation', file), (r) => {
        if (!r.nflverse_game_id || r.play_id == null) return;
        const k = key(r.nflverse_game_id, r.play_id);
        const x = participation.get(k) || { pressure: false, blitz: 0, rushers: 0, coverage: null, target: null };
        x.pressure ||= /true|1/i.test(r.was_pressure || '');
        x.blitz = Math.max(x.blitz, n(r.number_of_blitzers), /true|1/i.test(r.was_blitzer || '') ? 1 : 0);
        x.rushers = Math.max(x.rushers, n(r.number_of_pass_rushers), /true|1/i.test(r.was_pass_rusher || '') ? 1 : 0);
        x.coverage ||= cov(r.defense_man_zone_type) || cov(r.defense_coverage_type);
        if (/true|1/i.test(r.was_target || '')) x.target = r.display_name || r.player_name;
        participation.set(k, x);
      }, { columns: PART });
    }
    const games = new Map(), rush = new Map();
    const data = { def: {}, off: {}, qbs: {}, targets: {} };
    const inc = (x, f, epa) => { x[f].n++; x[f].epa += epa; };
    const addPass = (p) => {
      if (!(p.qb_dropback === '1' || p.pass === '1' || p.sack === '1') || !p.posteam || !p.defteam) return;
      const x = participation.get(key(p.game_id, p.play_id)) || {};
      const pressured = x.pressure || p.qb_hit === '1' || p.sack === '1';
      const blitz = x.blitz > 0 || x.rushers >= 5;
      const d = data.def[p.defteam] ||= { drop: 0, pressure: 0, coverage: 0, man: 0, blitz: 0 };
      const o = data.off[p.posteam] ||= { drop: 0, pressure: 0 };
      d.drop++; o.drop++; if (pressured) { d.pressure++; o.pressure++; } if (blitz) d.blitz++; if (x.coverage) { d.coverage++; if (x.coverage === 'man') d.man++; }
      const epa = n(p.epa), qk = nameKey(p.passer_player_name);
      if (qk) {
        const q = data.qbs[qk] ||= { name: p.passer_player_name, pressured: bucket(), clean: bucket(), man: bucket(), manOther: bucket(), blitz: bucket(), blitzOther: bucket(), cold: bucket(), wind: bucket(), night: bucket(), all: bucket() };
        inc(q, pressured ? 'pressured' : 'clean', epa); inc(q, x.coverage === 'man' ? 'man' : 'manOther', epa); inc(q, blitz ? 'blitz' : 'blitzOther', epa); inc(q, 'all', epa);
        if (!/dome|closed/i.test(p.roof || '') && n(p.temp) < 40) inc(q, 'cold', epa);
        if (!/dome|closed/i.test(p.roof || '') && n(p.wind) > 15) inc(q, 'wind', epa);
        if (/^(20|21|22|23)/.test(p.start_time || '')) inc(q, 'night', epa);
      }
      const target = x.target || p.receiver_player_name;
      if (target && x.coverage) { const t = (data.targets[p.posteam] ||= {})[nameKey(target)] ||= { name: target, man: bucket(), zone: bucket() }; inc(t, x.coverage, epa); }
    };
    const add = (p) => {
      if (!p.game_id || !p.home_team || !p.away_team) return;
      games.set(p.game_id, { home: p.home_team, away: p.away_team, hs: Math.max(n(p.total_home_score), n(p.home_score)), as: Math.max(n(p.total_away_score), n(p.away_score)) });
      if (p.play_type === 'run' && p.rush === '1' && p.rusher_player_name && p.posteam) { const k = `${p.game_id}|${p.posteam}|${p.rusher_player_name}`; const r = rush.get(k) || { game: p.game_id, team: p.posteam, player: p.rusher_player_name, yards: 0, carries: 0 }; r.yards += n(p.yards_gained); r.carries++; rush.set(k, r); }
      addPass(p);
    };
    for (const yr of [season - 1, season]) await streamCsv(assetUrl('pbp', `play_by_play_${yr}.csv.gz`), add, { columns: PBP });
    const ranking = (value) => Object.entries(data.def).sort((a, b) => b[1][value] - a[1][value]).reduce((o, [t], i) => (o[t] = i + 1, o), {});
    Object.values(data.def).forEach((d) => { d.manRate = rate(d.man, d.coverage); d.blitzRate = rate(d.blitz, d.drop); });
    data.defRank = Object.entries(data.def).sort((a, b) => rate(b[1].pressure, b[1].drop) - rate(a[1].pressure, a[1].drop)).reduce((o, [t], i) => (o[t] = i + 1, o), {});
    data.manRank = ranking('manRate'); data.blitzRank = ranking('blitzRate');
    data.olRank = Object.entries(data.off).sort((a, b) => rate(a[1].pressure, a[1].drop) - rate(b[1].pressure, b[1].drop)).reduce((o, [t], i) => (o[t] = i + 1, o), {});
    data.wr1 = Object.fromEntries(Object.entries(data.targets).map(([t, ps]) => [t, Object.values(ps).sort((a, b) => (b.man.n + b.zone.n) - (a.man.n + a.zone.n))[0]]));
    data.rush = [...rush.values()].map((r) => { const g = games.get(r.game); const win = g && (g.home === r.team ? g.hs > g.as : g.as > g.hs); return { ...r, win }; }).filter((r) => r.win !== undefined);
    return data;
  })().catch((e) => { memo = null; throw e; });
  return memo;
}

const qb = (side) => side?.starting_qb?.name;
const effect = (diff, scale = 4) => clamp(diff * scale, -1.8, 1.8);
const desc = (v) => `${v >= 0 ? '+' : ''}${one(v)}`;

function rbSignal(rows, side, team) {
  if (!side?.rb1?.name) return null;
  const x = rows.filter((r) => r.team === team && nameKey(r.player) === nameKey(side.rb1.name) && r.carries);
  if (x.length < 16 || x.reduce((s, r) => s + r.carries, 0) < 20) return null;
  const threshold = Math.round(x.map((r) => r.yards).sort((a, b) => a - b)[Math.floor(x.length / 2)] / 5) * 5;
  const record = (a) => a.reduce((z, r) => (r.win ? z.w++ : z.l++, z), { w: 0, l: 0 });
  const high = record(x.filter((r) => r.yards >= threshold)), low = record(x.filter((r) => r.yards < threshold));
  const hi = rate(high.w, high.w + high.l), lo = rate(low.w, low.w + low.l);
  if (high.w + high.l < 8 || low.w + low.l < 8 || Math.abs(hi - lo) < .25) return null;
  const impact = (hi > lo ? 1 : -1) * clamp(Math.abs(hi - lo) * 1.5, .4, 1.8);
  return make('🏃', 'RB1 team-results threshold', `${team} is ${high.w}-${high.l} when ${side.rb1.name} reaches ${threshold}+ rush yards and ${low.w}-${low.l} when held under—a ${Math.round(Math.abs(hi - lo) * 100)}-point win-rate split (2025–26). AFI ${impact > 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, x.length, team);
}

function conditionSignal(data, side, team, weather) {
  const f = weather?.forecast, name = qb(side); if (!f || !name) return null;
  const hour = Date.parse(weather.date || '') ? new Date(weather.date).getUTCHours() : -1;
  const kind = n(f.temp_f) < 40 ? 'cold' : n(f.wind_mph) > 15 ? 'wind' : (hour >= 20 || hour <= 3) ? 'night' : null, q = data.qbs[nameKey(name)];
  if (!kind || !q || q[kind].n < 50 || q.all.n - q[kind].n < 50) return null;
  const a = rate(q[kind].epa, q[kind].n), b = rate(q.all.epa - q[kind].epa, q.all.n - q[kind].n); if (Math.abs(a - b) < .08) return null;
  const forecast = kind === 'cold' ? `${Math.round(f.temp_f)}°F forecast` : kind === 'wind' ? `${Math.round(f.wind_mph)} mph forecast wind` : 'night kickoff', impact = effect(a - b);
  return make('🌦️', 'QB condition EPA split', `${name}: ${desc(a)} EPA/dropback in ${kind} games vs ${desc(b)} otherwise (${q[kind].n} vs ${q.all.n - q[kind].n} dropbacks; ${forecast}). AFI ${impact >= 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, q[kind].n, team);
}

function pressureSignal(data, side, team, opp) {
  const name = qb(side), q = data.qbs[nameKey(name)], d = data.def[opp], o = data.off[team]; if (!q || !d || !o || q.pressured.n < 50 || q.clean.n < 50) return null;
  const split = rate(q.pressured.epa, q.pressured.n) - rate(q.clean.epa, q.clean.n), dr = data.defRank[opp], or = data.olRank[team]; if (Math.abs(split) < .08 || !dr || !or || (33 - dr) + (or - 1) < 26) return null;
  const impact = effect(split);
  return make('💨', 'Pass rush vs. O-line', `${opp}'s pressure rate is ${one(rate(d.pressure, d.drop) * 100)}% (NFL rank ${dr}) vs ${team}'s ${one(rate(o.pressure, o.drop) * 100)}% allowed (rank ${or}); ${name} is ${desc(rate(q.pressured.epa, q.pressured.n))} EPA/dropback pressured vs ${desc(rate(q.clean.epa, q.clean.n))} clean (${q.pressured.n}/${q.clean.n}). AFI ${impact >= 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, q.pressured.n + q.clean.n, team);
}

function coverageSignal(data, side, team, opp, oppSide) {
  const w = data.wr1[team], d = data.def[opp]; if (!w || !d) return null; const kind = d.manRate >= .5 ? 'man' : 'zone', other = kind === 'man' ? 'zone' : 'man';
  if (w[kind].n < 30 || w[other].n < 30) return null; const a = rate(w[kind].epa, w[kind].n), b = rate(w[other].epa, w[other].n); if (Math.abs(a - b) < .08) return null;
  const impact = effect(a - b, 3), cb = oppSide?.cb1?.name ? `; top CB by depth-chart snaps: ${oppSide.cb1.name}` : '';
  return make('🎯', 'WR1 vs. coverage', `${w.name} has ${desc(a)} EPA/target vs ${kind} and ${desc(b)} vs ${other}; ${opp} uses ${kind} on ${one((kind === 'man' ? d.manRate : 1 - d.manRate) * 100)}% of charted coverage plays${cb}. AFI ${impact >= 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, w[kind].n, team);
}

function schemeSignal(data, side, team, opp) {
  const name = qb(side), q = data.qbs[nameKey(name)], d = data.def[opp]; if (!q || !d) return null;
  const kind = data.manRank[opp] <= 8 || data.manRank[opp] >= 25 ? 'man' : (data.blitzRank[opp] <= 8 || data.blitzRank[opp] >= 25 ? 'blitz' : null); if (!kind) return null;
  const other = `${kind}Other`, a = q[kind], b = q[other]; if (a.n < 50 || b.n < 50) return null; const av = rate(a.epa, a.n), bv = rate(b.epa, b.n); if (Math.abs(av - bv) < .08) return null;
  const rank = kind === 'man' ? data.manRank[opp] : data.blitzRank[opp], pct = kind === 'man' ? d.manRate : d.blitzRate, impact = effect(av - bv, 3.5);
  return make('🧭', 'Scheme extreme', `${opp} is NFL rank ${rank} in ${kind} rate (${one(pct * 100)}%); ${name} is ${desc(av)} EPA/dropback vs ${kind} and ${desc(bv)} otherwise (${a.n}/${b.n}). AFI ${impact >= 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, a.n, team);
}

async function getMicroMatchups({ season, home, away, weather, preview }) {
  const data = await load(season);
  const homeSide = preview?.home, awaySide = preview?.away;
  return [
    rbSignal(data.rush, awaySide, away), rbSignal(data.rush, homeSide, home),
    conditionSignal(data, awaySide, away, weather), conditionSignal(data, homeSide, home, weather),
    pressureSignal(data, awaySide, away, home), pressureSignal(data, homeSide, home, away),
    coverageSignal(data, awaySide, away, home, homeSide), coverageSignal(data, homeSide, home, away, awaySide),
    schemeSignal(data, awaySide, away, home), schemeSignal(data, homeSide, home, away)
  ].filter(Boolean).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3);
}
module.exports = { getMicroMatchups };
