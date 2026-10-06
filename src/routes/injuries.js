const express = require('express');
const router = express.Router();
const injuryService = require('../services/injuryService');

// GET /api/injuries[?status=Out] — league-wide injury report grouped by team.
router.get('/', async (req, res) => {
  try {
    const report = await injuryService.getLeagueInjuries();
    const { status } = req.query;
    const teams = status
      ? report.teams.map((t) => ({ ...t, injuries: t.injuries.filter((i) => i.status.toLowerCase() === String(status).toLowerCase()) }))
      : report.teams;
    res.json({ success: true, data: { ...report, teams }, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
