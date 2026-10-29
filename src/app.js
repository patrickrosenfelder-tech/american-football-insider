const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const gameRoutes = require('./routes/games');
const statsRoutes = require('./routes/stats');
const teamsRoutes = require('./routes/teams');
const standingsRoutes = require('./routes/standings');
const playersRoutes = require('./routes/players');
const injuriesRoutes = require('./routes/injuries');
const previewsRoutes = require('./routes/previews');
const tendenciesRoutes = require('./routes/tendencies');
const playoffsRoutes = require('./routes/playoffs');
const newsRoutes = require('./routes/news');
const socialRoutes = require('./routes/social');
const weatherRoutes = require('./routes/weather');
const trendsRoutes = require('./routes/trends');
const picksRoutes = require('./routes/picks');
const adminRoutes = require('./routes/admin');
const statusRoutes = require('./routes/status');
const modelRoutes = require('./routes/model');
const powerRankingsRoutes = require('./routes/powerRankings');
const tradesRoutes = require('./routes/trades');
const freeAgentsRoutes = require('./routes/freeAgents');
const marketRoutes = require('./routes/market');
const refresh = require('./jobs/refresh');
const scheduler = require('./jobs/scheduler');
const db = require('./db/database');
const cache = require('./cache/cacheManager');
const { renderMetadata } = require('./services/pageMetadata');
const { classifyPath } = require('./services/siteRoutes');
const { loadSummary } = require('./services/prerender');
const { securityHeaders } = require('./middleware/securityHeaders');
const siteRoutes = require('./routes/site');

const app = express();
// 3000/3001 are used by other local services on the dev Mac.
const PORT = process.env.PORT || 3002;
const CLIENT_DIST = process.env.CLIENT_DIST || path.join(__dirname, '../client/dist');

app.disable('x-powered-by');
app.use(securityHeaders());
app.use(cors());
if (process.env.PREVIEW_DEPLOYMENT === 'true') {
  app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
}
// A season's Python prediction artifact includes all model inputs and can be
// several hundred KB; Express's 100 KB default rejects an otherwise valid POST.
app.use(express.json({ limit: '1mb' }));

db.initialize();
cache.initialize();

app.use('/api/games', gameRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/standings', standingsRoutes);
app.use('/api/players', playersRoutes);
app.use('/api/injuries', injuriesRoutes);
app.use('/api/previews', previewsRoutes);
app.use('/api/tendencies', tendenciesRoutes);
app.use('/api/playoffs', playoffsRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/trends', trendsRoutes);
app.use('/api/picks', picksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/admin', adminRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/model', modelRoutes);
app.use('/api/power-rankings', powerRankingsRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/free-agents', freeAgentsRoutes);
app.use('/api/market', marketRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.use(siteRoutes);

// Cache policy for built files: Vite's content-hashed bundles never change; logos and
// icons are long-lived; the service worker and manifest must update promptly.
const staticCacheControl = (res, filePath) => {
  const rel = path.relative(CLIENT_DIST, filePath).split(path.sep).join('/');
  if (rel.startsWith('assets/')) res.set('Cache-Control', 'public, max-age=31536000, immutable');
  else if (rel === 'sw.js') res.set('Cache-Control', 'no-cache');
  // Logo/icon files are regenerated only by scripts; give replacements a new file name.
  else if (rel.startsWith('logos/') || rel.startsWith('icons/')) res.set('Cache-Control', 'public, max-age=31536000');
  else if (rel === 'manifest.webmanifest') res.set('Cache-Control', 'public, max-age=86400');
  else res.set('Cache-Control', 'public, max-age=3600');
};

// Serve the built React app (npm run build) with SPA fallback for known client routes.
if (fs.existsSync(CLIENT_DIST)) {
  const template = fs.readFileSync(path.join(CLIENT_DIST, 'index.html'), 'utf8');
  app.use(express.static(CLIENT_DIST, { index: false, setHeaders: staticCacheControl }));
  app.get('*', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    const route = classifyPath(req.path);
    if (!route.known) return res.status(404).type('html').send(renderMetadata(template, req.path, { notFound: true }));
    const summary = await loadSummary(req.path.split('/')[1] || '', route);
    if (summary.status === 404) return res.status(404).type('html').send(renderMetadata(template, req.path, { notFound: true }));
    return res.type('html').send(renderMetadata(template, req.path, summary));
  });
} else {
  app.get('/', (req, res) => {
    res.type('text').send('Frontend not built. Run `npm run build`, then restart. API is available under /api.');
  });
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`American Football Insider running on port ${PORT}`);
    // The old boot path downloaded and parsed every missing historical data set
    // (including the full play-by-play archive) before the scheduler started.
    // On Fly's 256 MB single CPU VM that monopolized the event loop long enough
    // for even /api/health to time out.  Start serving and schedule each bounded
    // refresh independently; the normal scheduler backfills data at its own
    // cadence without making application availability depend on a bulk import.
    refresh.loadStatus()
      .catch((error) => console.error('Refresh status load failed:', error.message))
      .finally(() => scheduler.start());
  });
}

module.exports = app;
