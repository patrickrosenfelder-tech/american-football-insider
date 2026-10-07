const { assetUrl, streamCsv } = require('./nflverseService');

// Signals are intentionally sparse: a player name plus a season average is
// not an edge. Each emitted row is a game-applicable split or team-result key.
const make = (icon, label, text, impact, sample) => ({ icon, label, text, impact: Math.max(-2, Math.min(2, impact)), sample });
const n = (v) => Number(v) || 0;
const one = (v) => Math.round(v * 10) / 10;
// nflverse PBP names are usually abbreviated (J.Conner); ESPN depth charts
// use display names (James Conner).  This stable key prevents a false miss.
const playerKey = (name) => {
  const bits = String(name || '').replace(/[^a-zA-Z. ]/g, '').trim().split(/[ .]+/).filter(Boolean);
  return bits.length ? `${bits[bits.length - 1].toLowerCase()}|${bits[0][0].toLowerCase()}` : '';
};
let historyPromise;
const HISTORY_COLUMNS = ['game_id', 'home_team', 'away_team', 'posteam', 'play_type', 'rush', 'pass', 'yards_gained', 'total_home_score', 'total_away_score', 'home_score', 'away_score', 'rusher_player_name', 'passer_player_name', 'complete_pass', 'incomplete_pass', 'interception', 'temp', 'wind', 'roof', 'game_time'];

const history = async (season) => {
  if (historyPromise) return historyPromise;
  historyPromise = (async () => {
    const games = new Map(); const rush = new Map(); const pass = new Map();
    const add = (p) => {
      if (!p.game_id || !p.home_team || !p.away_team) return;
      const g = games.get(p.game_id) || { home: p.home_team, away: p.away_team, hs: 0, as: 0 };
      g.hs = Math.max(g.hs, n(p.total_home_score), n(p.home_score)); g.as = Math.max(g.as, n(p.total_away_score), n(p.away_score)); games.set(p.game_id, g);
      if (p.play_type === 'run' && p.rush === '1' && p.rusher_player_name && p.posteam) {
        const k = `${p.game_id}|${p.posteam}|${p.rusher_player_name}`; const x = rush.get(k) || { gameId: p.game_id, team: p.posteam, player: p.rusher_player_name, yards: 0, carries: 0 };
        x.yards += n(p.yards_gained); x.carries += 1; rush.set(k, x);
      }
      if (p.play_type === 'pass' && p.pass === '1' && p.passer_player_name && p.posteam && (p.complete_pass === '1' || p.incomplete_pass === '1' || p.interception === '1')) {
        const k = `${p.game_id}|${p.posteam}|${p.passer_player_name}`; const x = pass.get(k) || { player: p.passer_player_name, attempts: 0, yards: 0, coldA: 0, coldY: 0, windA: 0, windY: 0, primeA: 0, primeY: 0 };
        x.attempts += 1; x.yards += n(p.yards_gained);
        const outdoor = !/dome|closed/i.test(p.roof || '');
        if (outdoor && n(p.temp) < 40) { x.coldA += 1; x.coldY += n(p.yards_gained); }
        if (outdoor && n(p.wind) > 15) { x.windA += 1; x.windY += n(p.yards_gained); }
        if (/^(20|21|22|23)/.test(p.game_time || '')) { x.primeA += 1; x.primeY += n(p.yards_gained); }
        pass.set(k, x);
      }
    };
    // Stream rather than retaining two full PBP seasons in a web request.
    // The resulting maps contain only player-game aggregates.
    await streamCsv(assetUrl('pbp', `play_by_play_${season - 1}.csv.gz`), add, { columns: HISTORY_COLUMNS });
    await streamCsv(assetUrl('pbp', `play_by_play_${season}.csv.gz`), add, { columns: HISTORY_COLUMNS });
    return { rush: [...rush.values()].map((x) => ({ ...x, game: games.get(x.gameId) })).filter((x) => x.game), pass: [...pass.values()] };
  })().catch((e) => { historyPromise = null; throw e; });
  return historyPromise;
};

const wins = (games) => games.reduce((r, x) => {
  const w = x.game.home === x.team ? x.game.hs > x.game.as : x.game.as > x.game.hs;
  if (w) r.w += 1; else r.l += 1; return r;
}, { w: 0, l: 0 });

const rbSignal = (rows, side, team) => {
  const rb = side?.rb1; if (!rb?.name) return null;
  const games = rows.filter((x) => x.team === team && playerKey(x.player) === playerKey(rb.name) && x.carries > 0);
  const carries = games.reduce((s, x) => s + x.carries, 0); if (games.length < 4 || carries < 20) return null;
  const y = games.map((x) => x.yards).sort((a, b) => a - b); const threshold = Math.round(y[Math.floor(y.length / 2)] / 5) * 5;
  const high = wins(games.filter((x) => x.yards >= threshold)); const low = wins(games.filter((x) => x.yards < threshold));
  const hiRate = high.w / (high.w + high.l); const loRate = low.w / (low.w + low.l);
  if (high.w + high.l < 2 || low.w + low.l < 2 || Math.abs(hiRate - loRate) < 0.25) return null;
  const impact = hiRate > loRate ? 0.8 : -0.8;
  return make('🏃', 'RB1 team-results threshold', `${team} is ${high.w}-${high.l} when ${rb.name} reaches ${threshold}+ rush yards and ${low.w}-${low.l} when held under (${carries} carries, 2025–26). AFI ${impact > 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, carries);
};

const qbSplit = (rows, side, weather) => {
  const qb = side?.starting_qb; const f = weather?.forecast; if (!qb?.name || !f) return null;
  const hour = Number.isFinite(Date.parse(weather.date || '')) ? new Date(weather.date).getUTCHours() : -1;
  const kind = n(f.temp_f) < 40 ? 'cold' : n(f.wind_mph) > 15 ? 'wind' : (hour >= 20 || hour <= 3) ? 'prime' : null;
  if (!kind) return null;
  const key = kind === 'cold' ? ['coldA', 'coldY', 'cold'] : kind === 'wind' ? ['windA', 'windY', 'wind'] : ['primeA', 'primeY', 'primetime'];
  const gs = rows.filter((x) => playerKey(x.player) === playerKey(qb.name)); const allA = gs.reduce((s, x) => s + x.attempts, 0); const allY = gs.reduce((s, x) => s + x.yards, 0);
  const a = gs.reduce((s, x) => s + x[key[0]], 0); const y = gs.reduce((s, x) => s + x[key[1]], 0); const otherA = allA - a;
  if (a < 50 || otherA < 50 || !allA) return null;
  const split = y / a; const other = (allY - y) / otherA; if (Math.abs(split - other) < 1) return null;
  const condition = kind === 'cold' ? `${Math.round(f.temp_f)}°F forecast` : kind === 'wind' ? `${Math.round(f.wind_mph)} mph forecast wind` : 'primetime kickoff'; const impact = split < other ? -0.8 : 0.8;
  return make('🌦️', 'QB condition split', `${qb.name}: ${one(split)} YPA in ${key[2]} games vs ${one(other)} otherwise (${a} attempts; ${condition}). AFI ${impact > 0 ? 'adds' : 'subtracts'} ${Math.abs(impact).toFixed(1)} point.`, impact, a);
};

async function getMicroMatchups({ season, home, away, weather, preview }) {
  const data = await history(season);
  return [rbSignal(data.rush, preview?.away, away), rbSignal(data.rush, preview?.home, home), qbSplit(data.pass, preview?.away, weather), qbSplit(data.pass, preview?.home, weather)]
    .filter(Boolean).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3);
}
module.exports = { getMicroMatchups };
