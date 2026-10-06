const express = require('express');
const router = express.Router();
const db = require('../db/database');
const sportsDataService = require('../services/sportsDataService');

router.get('/', async (req, res) => {
  try {
    const teams = await sportsDataService.getTeams();
    res.json({
      success: true,
      data: teams,
      count: teams.length,
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
