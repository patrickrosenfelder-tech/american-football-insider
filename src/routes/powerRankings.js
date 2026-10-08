const express = require('express');
const { getPowerRankings } = require('../services/modelService');
const { currentSeason } = require('../services/rosterService');
const router = express.Router();
router.get('/', async (req, res) => {
  try { res.json({ success: true, data: await getPowerRankings(Number(req.query.season) || currentSeason()), timestamp: new Date().toISOString() }); }
  catch (error) { res.status(502).json({ success: false, error: error.message }); }
});
module.exports = router;
