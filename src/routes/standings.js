const express = require('express');
const standingsService = require('../services/standingsService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const standings = await standingsService.getStandings();
    res.json({ standings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
