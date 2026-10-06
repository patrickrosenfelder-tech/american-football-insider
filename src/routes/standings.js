const express = require('express');
const router = express.Router();
const sportsDataService = require('../services/sportsDataService');

router.get('/', async (req, res) => {
  try {
    const standings = await sportsDataService.getStandings();
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
