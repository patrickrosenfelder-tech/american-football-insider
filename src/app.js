const express = require('express');
const cors = require('cors');

const gamesRouter = require('./routes/games');
const teamsRouter = require('./routes/teams');
const standingsRouter = require('./routes/standings');
const statsRouter = require('./routes/stats');
const playersRouter = require('./routes/players');
const cache = require('./cache');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'american-football-insider',
    time: new Date().toISOString(),
    cache: cache.stats(),
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'American Football Insider API',
    sources: ['espn', 'sleeper'],
    endpoints: [
      'GET /health',
      'GET /api/teams',
      'GET /api/teams/:id',
      'GET /api/games/scoreboard?week=&season=&seasontype=',
      'GET /api/games/db?week=&season=&seasontype=',
      'GET /api/games/:id',
      'GET /api/stats/game/:id',
      'GET /api/standings',
      'GET /api/players/trending?type=add|drop&limit=&hours=',
      'GET /api/players/injuries?team=',
      'WebSocket: scores:update events pushed to all connected clients',
    ],
  });
});

app.use('/api/games', gamesRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/standings', standingsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/players', playersRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.response?.status;
  // ESPN answers unknown team/event ids with 400 or 404.
  if (status === 400 || status === 404) {
    return res.status(404).json({ error: 'not_found', path: req.path });
  }
  console.error(err);
  return res.status(502).json({ error: 'upstream_error', message: err.message });
});

module.exports = app;
