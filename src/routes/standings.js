const express = require('express');
const router = express.Router();
const sportsDataService = require('../services/sportsDataService');

router.get('/', async (req, res) => {
  try {
    const standings = await sportsDataService.getStandings();
    // Cache at the edge/browser too.  Stale responses remain usable while a
    // background revalidation protects visitors from an ESPN stall.
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400');
    res.json({
      success: true,
      data: standings,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
