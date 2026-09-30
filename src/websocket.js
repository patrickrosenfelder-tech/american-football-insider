const { Server } = require('socket.io');
const gamesService = require('./services/gamesService');
const config = require('./config');

// Keyed by espn_id -> "home-away" score string, so we only emit on change.
let lastScores = {};

function diffScores(games) {
  const changed = [];
  for (const g of games) {
    const key = `${g.home_score}-${g.away_score}-${g.status_state}`;
    if (lastScores[g.espn_id] !== key) {
      lastScores[g.espn_id] = key;
      changed.push(g);
    }
  }
  return changed;
}

function attachWebSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    socket.emit('connected', { message: 'Subscribed to NFL live score updates' });
  });

  const poll = async () => {
    try {
      const games = await gamesService.fetchAndStoreScoreboard();
      const changed = diffScores(games);
      if (changed.length > 0) {
        io.emit('scores:update', { updatedAt: new Date().toISOString(), games: changed });
      }
    } catch (err) {
      io.emit('scores:error', { message: err.message });
    }
  };

  poll();
  const timer = setInterval(poll, config.pollIntervalMs);
  timer.unref();

  return io;
}

module.exports = { attachWebSocket };
