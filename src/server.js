const http = require('http');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { attachWebSocket } = require('./websocket');

const gamesRouter = require('./routes/games');
const teamsRouter = require('./routes/teams');
const standingsRouter = require('./routes/standings');
const statsRouter = require('./routes/stats');
const picksRouter = require('./routes/picks');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'american-football-insider', time: new Date().toISOString() });
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'american-football-insider', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({
    name: 'American Football Insider API',
    endpoints: [
      'GET /health',
      'GET /api/teams',
      'GET /api/teams/:id',
      'GET /api/games/scoreboard?week=&season=&seasontype=',
      'GET /api/games/db?week=&season=&seasontype=',
      'GET /api/games/:id',
      'GET /api/stats/game/:id',
      'GET /api/standings',
      'GET /api/picks?season=&week= (includes separately-labelled backtest)',
      'WebSocket: scores:update events pushed to all connected clients',
    ],
  });
});

app.use('/api/games', gamesRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/standings', standingsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/picks', picksRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(502).json({ error: 'upstream_error', message: err.message });
});

const server = http.createServer(app);
attachWebSocket(server);

server.listen(config.port, () => {
  console.log(`American Football Insider API listening on port ${config.port}`);
});

module.exports = { app, server };
