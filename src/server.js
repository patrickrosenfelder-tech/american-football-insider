const http = require('http');
const config = require('./config');
const app = require('./app');
const { attachWebSocket } = require('./websocket');

const server = http.createServer(app);
attachWebSocket(server);

server.listen(config.port, () => {
  console.log(`American Football Insider API listening on port ${config.port}`);
});

module.exports = { app, server };
