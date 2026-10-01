const axios = require('axios');
const cache = require('../cache/cacheManager');

const NFL_API_BASE = 'https://api.nfl.com/v1';

const nflHeaders = {
  'User-Agent': 'American-Football-Insider/1.0'
};

const mockGames = [
  {
    game_id: 'NFL_2024_W1_KC_BAL',
    week: 1,
    season: 2024,
    home_team: 'Kansas City Chiefs',
    away_team: 'Baltimore Ravens',
    home_score: 27,
    away_score: 20,
    game_date: '2024-09-05',
    status: 'final'
  },
  {
    game_id: 'NFL_2024_W1_GB_PHI',
    week: 1,
    season: 2024,
    home_team: 'Green Bay Packers',
    away_team: 'Philadelphia Eagles',
    home_score: 34,
    away_score: 29,
    game_date: '2024-09-06',
    status: 'final'
  },
  {
    game_id: 'NFL_2024_W1_DAL_CLE',
    week: 1,
    season: 2024,
    home_team: 'Dallas Cowboys',
    away_team: 'Cleveland Browns',
    home_score: 28,
    away_score: 23,
    game_date: '2024-09-08',
    status: 'final'
  }
];

const mockTeams = [
  { team_id: 'KC', team_name: 'Kansas City Chiefs', city: 'Kansas City', division: 'AFC West', conference: 'AFC', coach: 'Andy Reid' },
  { team_id: 'BAL', team_name: 'Baltimore Ravens', city: 'Baltimore', division: 'AFC North', conference: 'AFC', coach: 'John Harbaugh' },
  { team_id: 'GB', team_name: 'Green Bay Packers', city: 'Green Bay', division: 'NFC North', conference: 'NFC', coach: 'Matt LaFleur' },
  { team_id: 'PHI', team_name: 'Philadelphia Eagles', city: 'Philadelphia', division: 'NFC East', conference: 'NFC', coach: 'Jonathan Gannon' },
  { team_id: 'DAL', team_name: 'Dallas Cowboys', city: 'Dallas', division: 'NFC East', conference: 'NFC', coach: 'Mike McCarthy' },
  { team_id: 'CLE', team_name: 'Cleveland Browns', city: 'Cleveland', division: 'AFC North', conference: 'AFC', coach: 'Kevin Stefanski' }
];

const getGames = async (week = null, season = 2024) => {
  const cacheKey = `games_week_${week}_season_${season}`;

  return cache.getOrSet(cacheKey, async () => {
    try {
      return mockGames;
    } catch (error) {
      console.error('Error fetching games:', error.message);
      return mockGames;
    }
  });
};

const getTeams = async () => {
  return cache.getOrSet('teams_all', async () => {
    try {
      return mockTeams;
    } catch (error) {
      console.error('Error fetching teams:', error.message);
      return mockTeams;
    }
  }, 3600);
};

const getTeamStats = async (teamId, season = 2024) => {
  const cacheKey = `team_stats_${teamId}_${season}`;

  return cache.getOrSet(cacheKey, async () => {
    return {
      team_id: teamId,
      season,
      passing_yards: 4200,
      rushing_yards: 1800,
      receiving_yards: 3100,
      total_points: 385
    };
  });
};

const getGameScore = async (gameId) => {
  const game = mockGames.find(g => g.game_id === gameId);
  return game || null;
};

module.exports = {
  getGames,
  getTeams,
  getTeamStats,
  getGameScore
};
