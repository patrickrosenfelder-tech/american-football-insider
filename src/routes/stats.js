const express = require('express');
const db = require('../db');
const gamesService = require('../services/gamesService');
const validateId = require('./validateId');

const router = express.Router();
router.param('id', validateId);

// Player box-score stats for a given game, served from SQLite. On a cache
// miss the game summary is fetched from ESPN first, which populates the table.
router.get('/game/:id', async (req, res, next) => {
  try {
    let stats = db.getPlayerStatsForGame(req.params.id);
    if (stats.length === 0) {
      await gamesService.getGameDetail(req.params.id);
      stats = db.getPlayerStatsForGame(req.params.id);
    }
    res.json({
      game_espn_id: req.params.id,
      count: stats.length,
      stats: stats.map((s) => ({
        ...s,
        stat_keys: JSON.parse(s.stat_keys || '[]'),
        stat_values: JSON.parse(s.stat_values || '[]'),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
