const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../nfl-data.db');
const db = new sqlite3.Database(dbPath);

const initialize = () => {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT UNIQUE NOT NULL,
      week INTEGER,
      season INTEGER,
      home_team TEXT,
      away_team TEXT,
      home_score INTEGER,
      away_score INTEGER,
      game_date TEXT,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS team_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      team_name TEXT,
      season INTEGER,
      week INTEGER,
      passing_yards INTEGER,
      rushing_yards INTEGER,
      receiving_yards INTEGER,
      total_points INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, season, week)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT UNIQUE NOT NULL,
      team_name TEXT,
      city TEXT,
      division TEXT,
      conference TEXT,
      coach TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Derived datasets (nflverse aggregates) stored as JSON blobs keyed by name.
    db.run(`CREATE TABLE IF NOT EXISTS datasets (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      meta TEXT,
      updated_at TEXT NOT NULL
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_games_status ON games(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_stats_team ON team_stats(team_id)`);
  });
};

const run = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const get = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const saveDataset = (key, value, meta = {}) => run(
  `INSERT OR REPLACE INTO datasets (key, json, meta, updated_at) VALUES (?, ?, ?, ?)`,
  [key, JSON.stringify(value), JSON.stringify(meta), new Date().toISOString()]
);

const loadDataset = async (key) => {
  const row = await get(`SELECT json, meta, updated_at FROM datasets WHERE key = ?`, [key]);
  if (!row) return null;
  return { data: JSON.parse(row.json), meta: JSON.parse(row.meta || '{}'), updated_at: row.updated_at };
};

module.exports = {
  db,
  saveDataset,
  loadDataset,
  initialize,
  run,
  get,
  all
};
