const express = require('express');
const router = express.Router();
const sportsDataService = require('../services/sportsDataService');

router.get('/', async (req, res) => {
  try {
    const standings = await sportsDataService.getStandings();
    // Permit the browser/CDN to absorb repeat requests and continue using a
    // recent response while it revalidates. The payload itself has a server
    // cache and stale-while-revalidate fallback, so this never makes a slow
    // ESPN request part of the common page-load path.
    res.set('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600');
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
