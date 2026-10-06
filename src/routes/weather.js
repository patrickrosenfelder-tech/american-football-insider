const express = require('express');
const router = express.Router();
const weatherService = require('../services/weatherService');

// GET /api/weather[?week=6&season=2026&seasontype=2] — kickoff forecast + impact flags for every game of a week.
router.get('/', async (req, res) => {
  try {
    const { week, season, seasontype } = req.query;
    const data = await weatherService.getWeekWeather({ week: week ? Number(week) : null, season: season ? Number(season) : null, seasonType: seasontype ? Number(seasontype) : null });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// GET /api/weather/game/:gameId
router.get('/game/:gameId', async (req, res) => {
  try {
    const data = await weatherService.getGameWeather(req.params.gameId);
    if (!data) return res.status(404).json({ success: false, error: 'Game not found' });
    return res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
