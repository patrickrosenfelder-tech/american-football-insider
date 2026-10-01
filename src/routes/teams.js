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
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    const teams = await sportsDataService.getTeams();
    const team = teams.find(t => t.team_id === teamId.toUpperCase());

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    res.json({
      success: true,
      data: team,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:teamId/sync', async (req, res) => {
  try {
    const { teamId } = req.params;
    const teams = await sportsDataService.getTeams();
    const team = teams.find(t => t.team_id === teamId.toUpperCase());

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    await db.run(
      `INSERT OR REPLACE INTO teams (team_id, team_name, city, division, conference, coach)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [team.team_id, team.team_name, team.city, team.division, team.conference, team.coach]
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
