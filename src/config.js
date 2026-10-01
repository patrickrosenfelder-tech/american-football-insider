require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '4002', 10),
  espnBaseUrl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl',
  espnCoreUrl: 'https://cdn.espn.com/core/nfl',
  dbPath: process.env.DB_PATH || './data/football.db',
  cache: {
    scoreboardTtlSeconds: parseInt(process.env.SCOREBOARD_TTL || '20', 10),
    teamsTtlSeconds: parseInt(process.env.TEAMS_TTL || '86400', 10),
    gameTtlSeconds: parseInt(process.env.GAME_TTL || '15', 10),
    standingsTtlSeconds: parseInt(process.env.STANDINGS_TTL || '3600', 10),
  },
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),
};
