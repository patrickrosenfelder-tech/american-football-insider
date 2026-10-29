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

// The v3 artifact uses nflverse abbreviations; ESPN's differ for two teams.
const fromV3 = (ratings) => Object.fromEntries((ratings?.teams || []).map((t) => [t.team_espn || t.team, t]));

const getPowerRankings = async (season) => {
  const [model, elo, ratings] = await Promise.all([buildModel(season), eloHistory(season), require('./ratingsService').getRatings().catch(() => null)]);
  const v3 = ratings?.season === season ? fromV3(ratings) : {};
  const rows = Object.entries(model.teams).map(([id, team]) => {
    const name = model.byId[id];
    // AFI base Elo (results + roster) when the v3 artifact covers this season, else results-only Elo.
    const e = v3[name.abbreviation]?.base_elo ?? elo[name.abbreviation] ?? 1505;
    const score = team.efficiency.rating * 40 + team.recency.value * 2 + (e - 1505) / 18;
    const epa = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
    return { team: name.abbreviation, team_id: id, elo: Math.round(e), score: round(score),
      off_epa: epa(team.efficiency.off_epa), def_epa_allowed: epa(team.efficiency.def_epa),
      games: team.games, reason: `${name.abbreviation} is driven by ${team.efficiency.snippet}` };
  }).sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));
  const eloNote = Object.keys(v3).length ? `AFI base Elo (results + roster, ${ratings.model_version}, week ${ratings.week})` : 'results-only AFI Elo';
  return { season, version: registry.version, updated_at: new Date().toISOString(), elo_source: Object.keys(v3).length ? 'v3_base' : 'results',
    methodology: `Decay-weighted efficiency + ${eloNote}. Off EPA is expected points added per offensive play; Def EPA is per play allowed (lower is better).`, rankings: rows };
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
