const express = require('express');
const { getModel } = require('../services/modelService');
const { getAccuracy } = require('../services/ratingsService');
const router = express.Router();
router.get('/', async (_req, res) => {
  try { res.json({ success: true, data: await getModel(), timestamp: new Date().toISOString() }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
// GET /api/model/accuracy — walk-forward results vs Vegas + live AFI Picks record.
router.get('/accuracy', async (_req, res) => {
  try {
    const data = await getAccuracy();
    if (!data) return res.status(503).json({ success: false, error: 'Backtest not available' });
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
module.exports = router;
