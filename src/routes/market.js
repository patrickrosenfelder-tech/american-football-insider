const express = require('express');
const router = express.Router();
const marketLog = require('../services/marketLogService');

// GET /api/market/lines[?season=2026&week=8&game=401873023] — hourly line snapshots (opening + current).
router.get('/lines', async (req, res) => {
  try {
    const rows = await marketLog.lineHistory({ season: req.query.season, week: req.query.week, gameId: req.query.game });
    res.json({ success: true, data: rows, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/market/sentiment[?team=PHI&since=2026-10-28T00:00:00Z] — hourly per-team social volume + sentiment.
router.get('/sentiment', async (req, res) => {
  try {
    const rows = await marketLog.sentimentHistory({ team: req.query.team, since: req.query.since });
    res.json({ success: true, data: rows, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
