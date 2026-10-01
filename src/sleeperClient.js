const axios = require('axios');
const config = require('./config');

// Second upstream source: Sleeper's public NFL API (no key required).
// Supplies injury status and fantasy trending data that ESPN's site API lacks.
const http = axios.create({
  baseURL: config.sleeperBaseUrl,
  timeout: 20000,
  headers: { 'User-Agent': 'american-football-insider/1.0' },
});

async function getPlayers() {
  const { data } = await http.get('/players/nfl');
  return data;
}

async function getTrending(type = 'add', { lookbackHours = 24, limit = 25 } = {}) {
  const { data } = await http.get(`/players/nfl/trending/${type}`, {
    params: { lookback_hours: lookbackHours, limit },
  });
  return data;
}

async function getState() {
  const { data } = await http.get('/state/nfl');
  return data;
}

module.exports = { getPlayers, getTrending, getState };
