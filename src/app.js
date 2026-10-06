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
const refresh = require('./jobs/refresh');
const db = require('./db/database');
const cache = require('./cache/cacheManager');

const app = express();
// 3000/3001 are used by other local services on the dev Mac.
const PORT = process.env.PORT || 3002;
const CLIENT_DIST = path.join(__dirname, '../client/dist');

app.use(cors());
app.use(express.json());

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Serve the built React app (npm run build) with SPA fallback.
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));
  app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('text').send('Frontend not built. Run `npm run build`, then restart. API is available under /api.');
  });
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`American Football Insider running on port ${PORT}`);
    refresh.bootstrap().catch((error) => console.error('Bootstrap refresh failed:', error.message));
  });
}

module.exports = app;
