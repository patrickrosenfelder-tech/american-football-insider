const express = require('express');
const router = express.Router();
const db = require('../db/database');
const sportsDataService = require('../services/sportsDataService');
const rosterService = require('../services/rosterService');
const injuryService = require('../services/injuryService');
const tendencyService = require('../services/tendencyService');

router.get('/', async (req, res) => {
  try {
    const teams = await sportsDataService.getTeams();
    // Records come from standings, so that fetch is the list's freshness.
    const standings = await sportsDataService.getStandings().catch(() => null);
    res.json({
      success: true,
      data: teams,
      count: teams.length,
      last_updated: standings?.fetched_at || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// :teamId accepts an abbreviation (KC) or an ESPN team id (12)
router.get('/:teamId', async (req, res) => {
  try {
    const team = await sportsDataService.getTeamDetail(req.params.teamId);

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    res.json({
      success: true,
      data: team,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

const sendOr404 = (res, data, notFound = 'Team not found') => {
  if (!data) return res.status(404).json({ success: false, error: notFound });
  return res.json({ success: true, data, timestamp: new Date().toISOString() });
};

// Madden-style depth chart: offense / defense / special teams with depth 1-n per slot.
router.get('/:teamId/depthchart', async (req, res) => {
  try {
    const decorate = await injuryService.injuryDecorator();
    sendOr404(res, await rosterService.getDepthChart(req.params.teamId, { decorate }));
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// Full roster grouped by unit and position.
router.get('/:teamId/roster', async (req, res) => {
  try {
    const decorate = await injuryService.injuryDecorator();
    sendOr404(res, await rosterService.getRoster(req.params.teamId, { decorate }));
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// Team injury report: ESPN status + latest official practice participation.
router.get('/:teamId/injuries', async (req, res) => {
  try {
    const team = await sportsDataService.findTeam(req.params.teamId);
    sendOr404(res, team && await injuryService.getTeamInjuries(team));
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// Scheme tendencies: season + last 3 games (current season) and personnel/coverage reference season.
router.get('/:teamId/tendencies', async (req, res) => {
  try {
    const team = await sportsDataService.findTeam(req.params.teamId);
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    const season = Number(req.query.season) || rosterService.currentSeason();
    const view = await tendencyService.teamView(team.abbreviation, season);
    if (!view) return res.status(503).json({ success: false, error: 'Tendencies not built yet (refresh job pending)' });
    const depth = await rosterService.getDepthChart(team.abbreviation).catch(() => null);
    res.json({
      success: true,
      data: { ...view, team: { id: team.id, abbreviation: team.abbreviation, name: team.name, logo: team.logo }, base_front_depth_chart: depth?.base_defense || null },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

router.post('/:teamId/sync', async (req, res) => {
  try {
    const team = await sportsDataService.getTeamDetail(req.params.teamId);

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    await db.run(
      `INSERT OR REPLACE INTO teams (team_id, team_name, city, division, conference, coach)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [team.abbreviation, team.name, team.location, team.division, team.conference, null]
    );

    res.json({
      success: true,
      message: 'Team synced to database',
      data: team,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
