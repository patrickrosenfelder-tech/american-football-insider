const express = require('express');
const service = require('../services/freeAgentService');
const router = express.Router();
router.get('/', async (req, res) => { try { res.json({ success: true, data: await service.getFreeAgents(), timestamp: new Date().toISOString() }); } catch (e) { res.status(502).json({ success: false, error: e.message }); } });
module.exports = router;
