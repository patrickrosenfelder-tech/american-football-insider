const express = require('express');
const router = express.Router();
const picksService = require('../services/picksService');

// GET /api/picks[?week=6] — AFI model picks (spread / total / moneyline) with reasoning + season record.
router.get('/', async (req, res) => {
  try {
    const data = await picksService.getPicks({ week: req.query.week ? Number(req.query.week) : null });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
