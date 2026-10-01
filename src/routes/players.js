const express = require('express');
const playersService = require('../services/playersService');

const router = express.Router();

router.get('/trending', async (req, res, next) => {
  try {
    const type = req.query.type || 'add';
    if (!['add', 'drop'].includes(type)) {
      return res.status(400).json({ error: 'bad_request', message: 'type must be "add" or "drop"' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10) || 25, 1), 100);
    const lookbackHours = Math.min(Math.max(parseInt(req.query.hours || '24', 10) || 24, 1), 168);
    const players = await playersService.getTrending({ type, limit, lookbackHours });
    res.json({ source: 'sleeper', type, count: players.length, players });
  } catch (err) {
    next(err);
  }
});

router.get('/injuries', async (req, res, next) => {
  try {
    const players = await playersService.getInjuries({ team: req.query.team });
    res.json({ source: 'sleeper', count: players.length, players });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
