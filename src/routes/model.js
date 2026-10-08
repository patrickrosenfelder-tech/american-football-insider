const express = require('express');
const { getModel } = require('../services/modelService');
const router = express.Router();
router.get('/', async (_req, res) => {
  try { res.json({ success: true, data: await getModel(), timestamp: new Date().toISOString() }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
module.exports = router;
