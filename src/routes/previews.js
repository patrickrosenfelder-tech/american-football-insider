const express = require('express');
const router = express.Router();
const previewService = require('../services/previewService');

// GET /api/previews[?week=5&season=2026&seasontype=2] — games of the upcoming (or given) week.
router.get('/', async (req, res) => {
  try {
    const { week, season, seasontype } = req.query;
    const data = await previewService.listPreviews({ week, season, seasonType: seasontype });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// GET /api/previews/:gameId — full matchup preview.
router.get('/:gameId', async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.gameId)) return res.status(400).json({ success: false, error: 'gameId must be an ESPN event id' });
    const preview = await previewService.getPreview(req.params.gameId);
    if (!preview) return res.status(404).json({ success: false, error: 'Game not found' });
    res.json({ success: true, data: preview, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
