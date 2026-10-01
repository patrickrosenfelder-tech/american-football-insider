const express = require('express');
const validateId = require('./validateId');
const teamsService = require('../services/teamsService');

const router = express.Router();
router.param('id', validateId);

router.get('/', async (req, res, next) => {
  try {
    const teams = await teamsService.listTeams();
    res.json({ count: teams.length, teams });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const team = await teamsService.getTeam(req.params.id);
    res.json(team);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
