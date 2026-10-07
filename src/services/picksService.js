const espn = require('../espnClient');
const db = require('../db');

function competitor(competition, homeAway) {
  return competition.competitors?.find((item) => item.homeAway === homeAway) || {};
}

function completed(event) {
  return event.status?.type?.completed && Number.isFinite(Number(competitor(event.competitions?.[0] || {}, 'home').score));
}

function recordFor(team, before, games) {
  const prior = games.filter((game) => completed(game) && new Date(game.date) < before)
    .filter((game) => game.competitions?.[0]?.competitors?.some((c) => c.team?.displayName === team));
  let wins = 0;
  for (const game of prior) {
    const c = game.competitions[0].competitors.find((item) => item.team?.displayName === team);
    if (c.winner) wins += 1;
  }
  return { wins, games: prior.length, pct: prior.length ? wins / prior.length : 0.5 };
}

function lineFor(competition, away, home) {
  const odds = competition.odds?.[0] || {};
  const details = odds.details || '';
  const raw = Number(odds.spread);
  // ESPN's spread is normally the favorite's signed number; details identifies it.
  const favorite = details.startsWith(away.abbreviation) ? away.name
    : details.startsWith(home.abbreviation) ? home.name : null;
  if (!favorite || !Number.isFinite(raw)) return { favorite: null, homeSpread: null, total: Number(odds.overUnder) || null };
  const magnitude = Math.abs(raw);
  return { favorite, homeSpread: favorite === home.name ? -magnitude : magnitude, total: Number(odds.overUnder) || null };
}

function resultForPick(pick, home, away, homeScore, awayScore, homeSpread) {
  const pickedHome = pick === home.name;
  const selectedScore = pickedHome ? homeScore : awayScore;
  const opponentScore = pickedHome ? awayScore : homeScore;
  const su = selectedScore === opponentScore ? 'push' : selectedScore > opponentScore ? 'win' : 'loss';
  if (!Number.isFinite(homeSpread)) return { su, ats: null };
  const spread = pickedHome ? homeSpread : -homeSpread;
  const cover = selectedScore + spread - opponentScore;
  return { su, ats: cover === 0 ? 'push' : cover > 0 ? 'win' : 'loss' };
}

function stars(margin) { return Math.max(1, Math.min(5, Math.ceil(Math.abs(margin) / 2))); }

function makeBacktestRow(event, allGames) {
  const competition = event.competitions?.[0] || {};
  const home = competitor(competition, 'home');
  const away = competitor(competition, 'away');
  const kickoff = new Date(event.date);
  const homeRecord = recordFor(home.team?.displayName, kickoff, allGames);
  const awayRecord = recordFor(away.team?.displayName, kickoff, allGames);
  // Pre-kickoff rating: past win percentage only plus a fixed home-field value.
  // This is deterministic and does not consume the game's eventual score.
  const modelMargin = Number((1.5 + (homeRecord.pct - awayRecord.pct) * 7).toFixed(1));
  const modelPick = modelMargin >= 0 ? home.team?.displayName : away.team?.displayName;
  const line = lineFor(competition, { name: away.team?.displayName, abbreviation: away.team?.abbreviation }, { name: home.team?.displayName, abbreviation: home.team?.abbreviation });
  const homeScore = Number(home.score);
  const awayScore = Number(away.score);
  const modelResult = resultForPick(modelPick, home, away, homeScore, awayScore, line.homeSpread);
  const favoriteResult = line.favorite ? resultForPick(line.favorite, home, away, homeScore, awayScore, line.homeSpread) : {};
  const homeResult = resultForPick(home.team?.displayName, home, away, homeScore, awayScore, line.homeSpread);
  const total = homeScore + awayScore;
  return {
    game_espn_id: event.id, season: event.season?.year || 2026, week: event.week?.number,
    kickoff: event.date, away_team: away.team?.displayName, home_team: home.team?.displayName,
    model_pick: modelPick, model_margin: modelMargin, confidence_stars: stars(modelMargin),
    closing_spread: line.homeSpread, closing_total: line.total, away_score: awayScore, home_score: homeScore,
    su_result: modelResult.su, ats_result: modelResult.ats,
    ou_result: Number.isFinite(line.total) ? (total === line.total ? 'push' : total > line.total ? 'over' : 'under') : null,
    favorite_pick: line.favorite, favorite_su_result: favoriteResult.su || null,
    home_pick: home.team?.displayName, home_su_result: homeResult.su, created_at: new Date().toISOString(),
  };
}

function rate(rows, value, winner = 'win') {
  const eligible = rows.filter((row) => row[value] !== null && row[value] !== undefined);
  const won = eligible.filter((row) => row[value] === winner).length;
  return { wins: won, games: eligible.length, pct: eligible.length ? Number((won / eligible.length * 100).toFixed(1)) : null };
}

function summary(rows) {
  const byStars = {};
  for (const star of [1, 2, 3, 4, 5]) {
    const selected = rows.filter((row) => row.confidence_stars === star);
    byStars[star] = { su: rate(selected, 'su_result'), ats: rate(selected, 'ats_result'), ou: rate(selected, 'ou_result', 'over') };
  }
  return { games: rows.length, su: rate(rows, 'su_result'), ats: rate(rows, 'ats_result'), ou: rate(rows, 'ou_result', 'over'), byStars,
    baselines: { alwaysFavorite: rate(rows, 'favorite_su_result'), alwaysHome: rate(rows, 'home_su_result') } };
}

async function refreshBacktest(season = 2026) {
  const responses = await Promise.all([1, 2, 3].map((week) => espn.getScoreboard({ season, week, seasonType: 2 }).catch(() => ({ events: [] }))));
  const games = responses.flatMap((response) => response.events || []).sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const game of games.filter(completed)) db.upsertBacktest(makeBacktestRow(game, games));
  return db.listBacktests(season);
}

async function getPicks({ season, week, refreshBacktest: shouldRefresh = false } = {}) {
  const data = await espn.getScoreboard({ season, week, seasonType: 2 });
  const picks = (data.events || []).map((event) => {
    const competition = event.competitions?.[0] || {};
    const home = competitor(competition, 'home').team || {};
    const away = competitor(competition, 'away').team || {};
    const signals = []; // No matchup integration existed in the original API.
    return { gameId: event.id, kickoff: event.date, awayTeam: away.displayName, homeTeam: home.displayName,
      signals, reasoning: signals.length ? `AFI adjustment based on: ${signals.map((s) => s.text).join(' ')}` : null };
  });
  const rows = shouldRefresh ? await refreshBacktest(2026) : db.listBacktests(2026);
  return { count: picks.length, picks, backtest: { label: 'Backtest Weeks 1-3 (model re-run, not live picks)', weeks: [1, 2, 3], ...summary(rows), rows } };
}

module.exports = { getPicks, refreshBacktest, summary, makeBacktestRow };
