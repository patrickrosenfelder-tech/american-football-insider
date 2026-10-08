const { getPlayedGames } = require('./teamStatsService');
const { buildModel } = require('./picksService');

// Registry metadata is deliberately served from Node: prediction requests never
// need Python. Coefficients are learned/replaced by scripts/model/train.py.
const registry = require('../../scripts/model/model_v2.json');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n * 100) / 100;

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
  const [model, elo] = await Promise.all([buildModel(season), eloHistory(season)]);
  const rows = Object.entries(model.teams).map(([id, team]) => {
    const name = model.byId[id]; const e = elo[name.abbreviation] || 1505;
    const score = team.efficiency.rating * 40 + team.recency.value * 2 + (e - 1505) / 18;
    return { team: name.abbreviation, team_id: id, elo: Math.round(e), score: round(score),
      off_adj_epa_proxy: round(team.efficiency.ypp || 0), def_adj_epa_proxy: round(-(team.efficiency.ypp || 0)),
      games: team.games, reason: `${name.abbreviation} is driven by ${team.efficiency.snippet}` };
  }).sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));
  return { season, version: registry.version, updated_at: new Date().toISOString(), methodology: 'Decay-weighted efficiency proxy + AFI Elo. Availability is incorporated into game predictions and will be added to rankings when an official injury snapshot is present.', rankings: rows };
};

// Converts raw terms on a pick card into plain-language, learned feature
// contributions. Terms below 0.25 points are intentionally suppressed.
const explainPick = (pick) => {
  const c = [
    ['Recent team efficiency', pick.weighted_recency?.home - pick.weighted_recency?.away],
    ['Per-play efficiency', pick.efficiency_rating?.differential],
    ['Momentum and rest', pick.momentum?.differential],
    ['Matchup interaction', pick.matchup_adjustment]
  ].filter(([, value]) => Number.isFinite(value) && Math.abs(value) >= 0.25)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3)
    .map(([feature, points]) => ({ feature, points: round(points), favors: points >= 0 ? pick.home : pick.away }));
  return { version: registry.version, contributions: c };
};

module.exports = { getModel, getPowerRankings, explainPick, eloHistory };
