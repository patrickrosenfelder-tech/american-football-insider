const axios = require('axios');
const config = require('./config');

const http = axios.create({
  timeout: 8000,
  headers: { 'User-Agent': 'american-football-insider/1.0' },
});

async function getScoreboard({ week, season, seasonType } = {}) {
  const params = {};
  if (week) params.week = week;
  if (season) params.year = season;
  if (seasonType) params.seasontype = seasonType;
  const { data } = await http.get(`${config.espnBaseUrl}/scoreboard`, { params });
  return data;
}

async function getTeams() {
  const { data } = await http.get(`${config.espnBaseUrl}/teams`, { params: { limit: 40 } });
  return data;
}

async function getTeam(teamId) {
  const { data } = await http.get(`${config.espnBaseUrl}/teams/${teamId}`, {
    params: { enable: 'roster' },
  });
  return data;
}

async function getGameSummary(eventId) {
  const { data } = await http.get(`${config.espnBaseUrl}/summary`, { params: { event: eventId } });
  return data;
}

async function getStandings() {
  const { data } = await http.get('https://site.api.espn.com/apis/v2/sports/football/nfl/standings');
  return data;
}

module.exports = { getScoreboard, getTeams, getTeam, getGameSummary, getStandings };
