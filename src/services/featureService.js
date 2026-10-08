// Point-in-time feature assembly for the v2 registry.  Values are deliberately
// zeroed when their source is unavailable: zero is the training-time imputation
// used by scripts/model/train.py, and is preferable to silently adding a v1 rule.
const { getPlayedGames, getTeamStats } = require('./teamStatsService');
const { eloHistory } = require('./modelService');

const weighted = (xs, halfLife = 5) => {
  if (!xs.length) return null;
  const ws = xs.map((_, i) => Math.exp(-Math.log(2) * (xs.length - 1 - i) / halfLife));
  return xs.reduce((n, x, i) => n + x * ws[i], 0) / ws.reduce((n, x) => n + x, 0);
};
const value = (n) => Number.isFinite(n) ? n : null;
const put = (out, key, n) => { out[key] = value(n) ?? 0; out[`${key}_missing`] = value(n) == null ? 1 : 0; };
const margin = (g, team) => g.home === team ? g.home_score - g.away_score : g.away_score - g.home_score;

// Export-compatible definitions for schedule-backed features.  EPA features
// use the latest point-in-time team-stat snapshot until per-game PBP snapshots
// have been persisted; their missing flags preserve the model's imputation.
const buildFeatures = async ({ season, home, away, kickoff, neutralSite = false, availabilityHome = null, availabilityAway = null }) => {
  const [games, stats, elo] = await Promise.all([getPlayedGames(), getTeamStats(season), eloHistory(season)]);
  const past = (games || []).filter((g) => g.game_type === 'REG' && g.date < kickoff && (g.home === home || g.away === home || g.home === away || g.away === away));
  const hist = (team) => past.filter((g) => g.home === team || g.away === team);
  const h = hist(home); const a = hist(away);
  const mean = (rows, fn) => weighted(rows.map(fn).filter(Number.isFinite));
  const hMargin = mean(h, (g) => margin(g, home)); const aMargin = mean(a, (g) => margin(g, away));
  const upset = (rows, team) => mean(rows, (g) => Number((g.home === team ? g.spread_line > 0 && g.home_score > g.away_score : g.spread_line < 0 && g.away_score > g.home_score)));
  const homeStat = stats?.teams?.[home]; const awayStat = stats?.teams?.[away];
  const off = (t, key) => value(t?.offense?.[key]); const def = (t, key) => value(t?.defense?.[key]);
  const d = (x, y) => value(x) == null || value(y) == null ? null : x - y;
  const adj = d(d(off(homeStat, 'epa_per_play'), def(awayStat, 'epa_per_play')), d(off(awayStat, 'epa_per_play'), def(homeStat, 'epa_per_play')));
  const pass = null; const rush = null; const pressure = null; // not yet present in team_stats contract
  const success = d(off(homeStat, 'success_rate'), off(awayStat, 'success_rate'));
  const dates = (rows) => rows.map((g) => new Date(g.date)).sort((x, y) => y - x);
  const rest = (rows) => dates(rows)[0] ? Math.round((new Date(kickoff) - dates(rows)[0]) / 86400000) : null;
  const avail = value(availabilityHome) == null || value(availabilityAway) == null ? null : availabilityHome - availabilityAway;
  const eloDiff = (elo[home] || 1505) + (neutralSite ? 0 : 48) - (elo[away] || 1505);
  const out = { home_field: neutralSite ? 0 : 1, elo_diff: eloDiff, elo_home_prob: 1 / (1 + 10 ** (-eloDiff / 400)) };
  put(out, 'adj_epa_diff', adj); put(out, 'pass_epa_diff', pass); put(out, 'rush_epa_diff', rush); put(out, 'success_diff', success == null ? null : success / 100);
  put(out, 'margin_diff', d(hMargin, aMargin)); put(out, 'early_pass_diff', null); put(out, 'pressure_diff', pressure);
  put(out, 'pass_epa_x_pressure', null); put(out, 'rush_epa_x_rush_def', null); put(out, 'rest_diff', d(rest(h), rest(a)));
  put(out, 'availability_diff', avail); out.availability_missing = avail == null ? 1 : 0;
  put(out, 'recent_margin_diff', d(hMargin, aMargin)); put(out, 'upset_diff', d(upset(h, home), upset(a, away)));
  return out;
};
module.exports = { buildFeatures, weighted };
