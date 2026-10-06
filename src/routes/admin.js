const express = require('express');
const router = express.Router();
const refresh = require('../jobs/refresh');
const scheduler = require('../jobs/scheduler');

// Bearer ADMIN_TOKEN (Fly secret). Without the secret set, admin endpoints are disabled.
const requireAdmin = (req, res, next) => {
  const token = process.env.ADMIN_TOKEN;
  const given = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-admin-token');
  if (!token) return res.status(503).json({ success: false, error: 'ADMIN_TOKEN not configured' });
  if (given !== token) return res.status(401).json({ success: false, error: 'Unauthorized' });
  return next();
};

// GET /api/admin/jobs — public: schedule + last run per job (no secrets).
router.get('/jobs', (req, res) => {
  res.json({ success: true, data: scheduler.describe(), timestamp: new Date().toISOString() });
});

// POST /api/admin/jobs/:job/run — manual trigger. ?wait=1 blocks until the job finishes.
router.post('/jobs/:job/run', requireAdmin, async (req, res) => {
  const entry = scheduler.SCHEDULE.find((s) => s.job === req.params.job);
  if (!entry) return res.status(404).json({ success: false, error: `Unknown job. Jobs: ${scheduler.SCHEDULE.map((s) => s.job).join(', ')}` });
  if (refresh.status[entry.job]?.running) return res.status(409).json({ success: false, error: 'Job already running' });
  const job = entry.run();
  if (req.query.wait) return res.json({ success: true, data: await job });
  job.catch(() => {});
  return res.status(202).json({ success: true, data: { job: entry.job, started: true } });
});

module.exports = router;
