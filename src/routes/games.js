const express = require('express');
const gamesService = require('../services/gamesService');
const db = require('../db');

const router = express.Router();

router.get('/scoreboard', async (req, res, next) => {
  try {
    const { week, season, seasontype: seasonType } = req.query;
    const games = await gamesService.getScoreboard({ week, season, seasonType });
    res.json({ count: games.length, games });
  } catch (err) {
    next(err);
  }
});

router.get('/db', (req, res, next) => {
  try {
    const { season, week, seasontype: seasonType } = req.query;
    const games = db.listGames({ season, week, seasonType });
    res.json({ count: games.length, games, source: 'sqlite-cache' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const game = await gamesService.getGameDetail(req.params.id);
    res.json(game);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
