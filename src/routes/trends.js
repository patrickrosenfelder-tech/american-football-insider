const express = require('express');
const router = express.Router();
const trendsService = require('../services/trendsService');
const { getGameDetail, findTeam } = require('../services/sportsDataService');

// GET /api/trends/team/:team[?season=2026] — ATS / O-U / SU splits, last 5, rest, key trends.
router.get('/team/:team', async (req, res) => {
  try {
    const team = await findTeam(req.params.team);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const data = await trendsService.teamTrends(team.abbreviation, Number(req.query.season) || undefined);
    if (!data) return res.status(503).json({ success: false, error: 'Schedules not loaded yet (refresh job pending)' });
    return res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message });
  }
});

// GET /api/trends/game/:gameId — both teams' trends for a matchup.
router.get('/game/:gameId', async (req, res) => {
  try {
    const g = await getGameDetail(req.params.gameId);
    if (!g) return res.status(404).json({ success: false, error: 'Game not found' });
    const [away, home] = await Promise.all([trendsService.teamTrends(g.away.abbreviation, g.season), trendsService.teamTrends(g.home.abbreviation, g.season)]);
    if (!away || !home) return res.status(503).json({ success: false, error: 'Schedules not loaded yet (refresh job pending)' });
    return res.json({ success: true, data: { game_id: g.game_id, away, home }, timestamp: new Date().toISOString() });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
