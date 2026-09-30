const express = require('express');
const db = require('../db');

const router = express.Router();

// Player box-score stats for a given game, backed by the local SQLite cache
// that /api/games/:id populates on each fetch.
router.get('/game/:id', (req, res, next) => {
  try {
    const stats = db.getPlayerStatsForGame(req.params.id);
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
