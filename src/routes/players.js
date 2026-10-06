const express = require('express');
const router = express.Router();
const rosterService = require('../services/rosterService');
const injuryService = require('../services/injuryService');

// GET /api/players/:athleteId  (ESPN athlete id) — bio, season stats, AFI rating breakdown.
router.get('/:athleteId', async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.athleteId)) {
      return res.status(400).json({ success: false, error: 'athleteId must be an ESPN athlete id' });
    }
    const decorate = await injuryService.injuryDecorator();
    const player = await rosterService.getPlayer(req.params.athleteId, { decorate });
    if (!player) return res.status(404).json({ success: false, error: 'Player not found' });
    res.json({ success: true, data: player, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
