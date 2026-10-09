const express = require('express');
const router = express.Router();
const socialService = require('../services/socialService');

// GET /api/social?platform=bluesky|youtube|reddit (comma list ok)&account=<handle|channel_id|r/sub>&team=PHI&limit=50
// Newest first; each post carries `breaking` (insider post with a news keyword in the last 30 minutes).
router.get('/', async (req, res) => {
  try {
    const data = await socialService.list({
      platform: req.query.platform || null,
      account: req.query.account || null,
      team: req.query.team || null,
      limit: Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

// GET /api/social/status — per platform and per account health.
router.get('/status', async (req, res) => {
  try {
    res.json({ success: true, data: await socialService.status(), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

module.exports = router;
