const express = require('express');
const router = express.Router();
const newsService = require('../services/newsService');

// GET /api/news?team=PHI&kind=data|headline&limit=60 — readable stories (AI summaries + data stories) and
// remaining unsummarised headlines (link-outs only).
router.get('/', async (req, res) => {
  try {
    const data = await newsService.list({ team: req.query.team || null, kind: req.query.kind || null, limit: Math.min(Number(req.query.limit) || 60, 200) });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// GET /api/news/status — last runs: provider used per run, stories summarised, missing LLM keys (names only).
router.get('/status', async (req, res) => {
  try {
    res.json({ success: true, data: await newsService.status(), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// GET /api/news/:id — one story with summary/body, tags and sources.
router.get('/:id', async (req, res) => {
  try {
    const story = await newsService.get(req.params.id);
    if (!story) return res.status(404).json({ success: false, error: 'Story not found' });
    return res.json({ success: true, data: story, timestamp: new Date().toISOString() });
  } catch (error) {
    return res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
