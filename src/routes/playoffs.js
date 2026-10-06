const express = require('express');
const router = express.Router();
const playoffService = require('../services/playoffService');

// GET /api/playoffs — teams, full regular-season schedule (results + win probabilities), current seeds.
router.get('/', async (req, res) => {
  try {
    res.json({ success: true, data: await playoffService.getOverview(Number(req.query.season) || undefined), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// GET /api/playoffs/odds — Monte Carlo playoff odds (10,000 sims of remaining games).
router.get('/odds', async (req, res) => {
  try {
    res.json({ success: true, data: await playoffService.getOdds(Number(req.query.season) || undefined), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// POST /api/playoffs/scenario  { picks: { "<gameId>": "H" | "A" | "T" } } — standings/seeds/bracket for those picks.
router.post('/scenario', async (req, res) => {
  try {
    const picks = req.body?.picks && typeof req.body.picks === 'object' ? req.body.picks : {};
    res.json({ success: true, data: await playoffService.scenario(picks, Number(req.body?.season) || undefined), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
