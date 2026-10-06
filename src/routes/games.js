const express = require('express');
const router = express.Router();
const db = require('../db/database');
const sportsDataService = require('../services/sportsDataService');

// GET /api/games?week=5&season=2026&seasontype=2
// Without params returns ESPN's current scoreboard (this week's games).
router.get('/', async (req, res) => {
  try {
    const { week, season, seasontype } = req.query;
    const board = await sportsDataService.getScoreboard({ week, season, seasonType: seasontype });
    res.json({
      success: true,
      season: board.season,
      season_type: board.season_type,
      week: board.week,
      teams_on_bye: board.teams_on_bye,
      calendar: board.calendar,
      data: board.games,
      count: board.games.length,
      source: 'espn',
      last_updated: board.fetched_at,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

router.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await sportsDataService.getGameDetail(gameId);

    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    res.json({
      success: true,
      data: game,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

router.post('/:gameId/sync', async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await sportsDataService.getGameDetail(gameId);

    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    await db.run(
      `INSERT OR REPLACE INTO games (game_id, week, season, home_team, away_team, home_score, away_score, game_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [game.game_id, game.week, game.season, game.home.name, game.away.name, game.home.score, game.away.score, game.date, game.status.state]
    );

    res.json({
      success: true,
      message: 'Game synced to database',
      data: game,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
