const express = require('express');
const { search } = require('../services/searchService');
const router = express.Router();

// GET /api/search?q=mahomes — teams, players and this week's games matching the query.
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').slice(0, 60);
    res.json({ success: true, data: await search(q), timestamp: new Date().toISOString() });
  } catch (error) { res.status(502).json({ success: false, error: error.message }); }
});

module.exports = router;
