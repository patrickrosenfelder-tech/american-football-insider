const espn = require('../espnClient');
const db = require('../db');
const cache = require('../cache');
const config = require('../config');

function normalizeEvent(event) {
  const competition = event.competitions?.[0] || {};
  const home = competition.competitors?.find((c) => c.homeAway === 'home') || {};
  const away = competition.competitors?.find((c) => c.homeAway === 'away') || {};
  const status = event.status || {};

  return {
    espn_id: event.id,
    season: event.season?.year || null,
    week: event.week?.number || null,
    season_type: event.season?.type || null,
    start_date: event.date,
    home_team_id: home.team?.id || null,
    away_team_id: away.team?.id || null,
    home_team_name: home.team?.displayName || null,
    away_team_name: away.team?.displayName || null,
    home_score: home.score !== undefined ? Number(home.score) : null,
    away_score: away.score !== undefined ? Number(away.score) : null,
    status_state: status.type?.state || null,
    status_detail: status.type?.detail || null,
    period: status.period ?? null,
    display_clock: status.displayClock || null,
    venue: competition.venue?.fullName || null,
    updated_at: new Date().toISOString(),
  };
}

async function fetchAndStoreScoreboard({ week, season, seasonType } = {}) {
  const data = await espn.getScoreboard({ week, season, seasonType });
  const events = data.events || [];
  const games = events.map(normalizeEvent);
  for (const game of games) db.upsertGame(game);
  return games;
}

async function getScoreboard({ week, season, seasonType } = {}) {
  const key = `scoreboard:${season || 'current'}:${week || 'current'}:${seasonType || 'current'}`;
  return cache.wrap(key, config.cache.scoreboardTtlSeconds, () =>
    fetchAndStoreScoreboard({ week, season, seasonType }));
}

function extractPlayerStats(gameEspnId, boxscore) {
  const rows = [];
  for (const teamBlock of boxscore?.players || []) {
    const teamName = teamBlock.team?.displayName || null;
    const teamEspnId = teamBlock.team?.id || null;
    for (const category of teamBlock.statistics || []) {
      for (const athleteEntry of category.athletes || []) {
        rows.push({
          game_espn_id: gameEspnId,
          team_espn_id: teamEspnId,
          team_name: teamName,
          player_name: athleteEntry.athlete?.displayName || 'Unknown',
          position: athleteEntry.athlete?.position?.abbreviation || null,
          stat_category: category.name,
          stat_keys: JSON.stringify(category.keys || []),
          stat_values: JSON.stringify(athleteEntry.stats || []),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
  return rows;
}

async function getGameDetail(eventId) {
  const key = `game:${eventId}`;
  return cache.wrap(key, config.cache.gameTtlSeconds, async () => {
    const summary = await espn.getGameSummary(eventId);
    const header = summary.header || {};
    const competition = header.competitions?.[0] || {};

    const playerStats = extractPlayerStats(eventId, summary.boxscore);
    for (const row of playerStats) db.upsertPlayerStat(row);

    const teamStats = (summary.boxscore?.teams || []).map((t) => ({
      team: t.team?.displayName,
      statistics: t.statistics,
    }));

    return {
      espn_id: eventId,
      name: header.gameNote || null,
      competitors: competition.competitors?.map((c) => ({
        team: c.team?.displayName,
        score: c.score,
        homeAway: c.homeAway,
        winner: c.winner || false,
      })),
      status: competition.status,
      teamStatistics: teamStats,
      playerStats,
      leaders: summary.leaders,
    };
  });
}

module.exports = { getScoreboard, getGameDetail, fetchAndStoreScoreboard };
