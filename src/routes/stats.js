const express = require('express');
const router = express.Router();
const db = require('../db/database');
const sportsDataService = require('../services/sportsDataService');

router.get('/team/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    const { season = 2024 } = req.query;

    const stats = await sportsDataService.getTeamStats(teamId, season);

    if (!stats) {
      return res.status(404).json({ success: false, error: 'Team stats not found' });
    }

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/team/:teamId/cache-refresh', async (req, res) => {
  try {
    const { teamId } = req.params;
    const { season = 2024 } = req.query;

    const cache = require('../cache/cacheManager');
    const cacheKey = `team_stats_${teamId}_${season}`;
    cache.del(cacheKey);

    const stats = await sportsDataService.getTeamStats(teamId, season);

    res.json({
      success: true,
      message: 'Stats cache refreshed',
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
