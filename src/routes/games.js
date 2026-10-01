const express = require('express');
const router = express.Router();
const db = require('../db/database');
const sportsDataService = require('../services/sportsDataService');

router.get('/', async (req, res) => {
  try {
    const { week, season = 2024 } = req.query;
    const games = await sportsDataService.getGames(week, season);
    res.json({
      success: true,
      data: games,
      count: games.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await sportsDataService.getGameScore(gameId);

    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    res.json({
      success: true,
      data: game,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:gameId/sync', async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await sportsDataService.getGameScore(gameId);

    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    await db.run(
      `INSERT OR REPLACE INTO games (game_id, week, season, home_team, away_team, home_score, away_score, game_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [game.game_id, game.week, game.season, game.home_team, game.away_team, game.home_score, game.away_score, game.game_date, game.status]
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
