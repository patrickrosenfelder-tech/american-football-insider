const { getPlayedGames } = require('./teamStatsService');
const { getTeamStats } = require('./teamStatsService');

// Registry metadata is deliberately served from Node: prediction requests never
// need Python. Coefficients are learned/replaced by scripts/model/train.py.
const registry = require('../../scripts/model/model_v2.json');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n * 100) / 100;
const sigmoid = (n) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, n))));

// Coefficients are stored in original feature units by train.py.  Keeping this
// calculation here makes the registry the single source of truth for live
// predictions, backtests, and contribution explanations.
const predict = (features) => {
  const score = (kind) => (registry.intercepts?.[kind] || 0) + registry.features.reduce((sum, key) => sum + (registry.coefficients[kind][key] || 0) * (Number(features[key]) || 0), 0);
  const logit = score('win_probability');
  return { home_win_probability: sigmoid(logit), home_margin: score('home_margin'), logit };
};

const eloHistory = async (season) => {
  const games = (await getPlayedGames()).filter((g) => g.game_type === 'REG' && g.home_score != null && g.season <= season)
    .sort((a, b) => a.date.localeCompare(b.date));
  const ratings = {};
  let priorSeason = null;
  for (const g of games) {
    if (priorSeason != null && g.season !== priorSeason) Object.keys(ratings).forEach((t) => { ratings[t] = 1505 + (ratings[t] - 1505) * 2 / 3; });
    priorSeason = g.season;
    const home = ratings[g.home] || 1505; const away = ratings[g.away] || 1505;
    const expected = 1 / (1 + 10 ** (-(home + 48 - away) / 400));
    const actual = g.home_score > g.away_score ? 1 : 0;
    const mov = Math.log(Math.abs(g.home_score - g.away_score) + 1) * (2.2 / ((home - away) * 0.001 + 2.2));
    const delta = 20 * mov * (actual - expected);
    ratings[g.home] = home + delta; ratings[g.away] = away - delta;
  }
  return ratings;
};

const getModel = async () => ({
  ...registry,
  generated_at: registry.generated_at,
  disclaimer: 'AFI Model is for entertainment only, not betting advice.',
  promotion_rule: 'Promote only when out-of-sample log loss improves and straight-up accuracy does not decline.'
});

const getPowerRankings = async (season) => {
  const [stats, elo] = await Promise.all([getTeamStats(season), eloHistory(season)]);
  const rows = Object.entries(stats?.teams || {}).map(([team, data]) => {
    const e = elo[team] || 1505;
    const neutral = { adj_epa_diff: (data.offense?.epa_per_play || 0) - (data.defense?.epa_per_play || 0), home_field: 0, elo_diff: 0, elo_home_prob: .5 };
    const modelMargin = predict(neutral).home_margin;
    // Elo is reported separately; score is the learned neutral-field margin.
    return { team, elo: Math.round(e), score: round(modelMargin), model_margin: round(modelMargin),
      qb_availability: 'not available', games: data.games || 0,
      reason: `${team}: v2 neutral-field margin from learned coefficients; Elo ${Math.round(e)} is shown alongside it.` };
  }).sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));
  return { season, version: registry.version, model_version: registry.version, updated_at: new Date().toISOString(), methodology: 'V2 learned neutral-field margin (EPA feature inputs) with Elo and QB availability reported alongside; no hand-selected rating weights.', rankings: rows };
};

// Converts raw terms on a pick card into plain-language, learned feature
// contributions. Terms below 0.25 points are intentionally suppressed.
const explainPick = (pick) => {
  const c = registry.features.map((key) => [key, (registry.coefficients.home_margin[key] || 0) * (Number(pick.features?.[key]) || 0)])
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value) >= 0.05)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3)
    .map(([feature, points]) => ({ feature: feature.replaceAll('_', ' '), points: round(points), favors: points >= 0 ? pick.home : pick.away }));
  return { version: registry.version, contributions: c };
};

module.exports = { getModel, getPowerRankings, explainPick, eloHistory, predict, registry };
