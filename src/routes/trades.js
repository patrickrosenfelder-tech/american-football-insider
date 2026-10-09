const express = require('express');
const service = require('../services/tradeService');
const router = express.Router();
router.get('/', async (req, res) => { try { res.json({ success: true, data: await service.getTrades(req.query), timestamp: new Date().toISOString() }); } catch (e) { res.status(502).json({ success: false, error: e.message }); } });
router.get('/rumors', async (req, res) => { try { res.json({ success: true, data: await service.getRumors(), timestamp: new Date().toISOString() }); } catch (e) { res.status(502).json({ success: false, error: e.message }); } });
module.exports = router;
