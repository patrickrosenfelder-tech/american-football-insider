const express = require('express');
const picks = require('../services/picksService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { season, week, refreshBacktest } = req.query;
    res.json(await picks.getPicks({ season, week, refreshBacktest: refreshBacktest === 'true' }));
  } catch (error) { next(error); }
});

router.post('/backtest/refresh', async (req, res, next) => {
  try {
    const rows = await picks.refreshBacktest(Number(req.body?.season) || 2026);
    res.json({ label: 'Backtest Weeks 1-3 (model re-run, not live picks)', ...picks.summary(rows) });
  } catch (error) { next(error); }
});

module.exports = router;
