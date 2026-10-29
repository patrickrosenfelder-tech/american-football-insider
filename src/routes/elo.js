const express = require('express');
const { getRatings } = require('../services/ratingsService');
const router = express.Router();

// GET /api/elo — AFI v3 base Elo (results Elo + roster adjustment by position group).
router.get('/', async (_req, res) => {
  try {
    const data = await getRatings();
    if (!data) return res.status(503).json({ success: false, error: 'Ratings not published yet' });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
