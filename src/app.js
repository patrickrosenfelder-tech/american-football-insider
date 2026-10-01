const express = require('express');
const cors = require('cors');
require('dotenv').config();

const gameRoutes = require('./routes/games');
const statsRoutes = require('./routes/stats');
const teamsRoutes = require('./routes/teams');
const db = require('./db/database');
const cache = require('./cache/cacheManager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

db.initialize();
cache.initialize();

app.use('/api/games', gameRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/teams', teamsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`American Football Insider API running on port ${PORT}`);
});

module.exports = app;
