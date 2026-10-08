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

    db.run(`CREATE TABLE IF NOT EXISTS picks_backtest (
      game_id TEXT PRIMARY KEY, season INTEGER NOT NULL, week INTEGER NOT NULL,
      kickoff TEXT, away TEXT NOT NULL, home TEXT NOT NULL, model_json TEXT NOT NULL,
      closing_spread REAL, closing_total REAL, home_score INTEGER, away_score INTEGER,
      results_json TEXT NOT NULL, created_at TEXT NOT NULL
    )`);

    // Point-in-time model artifacts and walk-forward results. JSON columns keep
    // the registry portable while the training job is intentionally file based.
    db.run(`CREATE TABLE IF NOT EXISTS model_runs (
      model_version TEXT PRIMARY KEY, trained_at TEXT NOT NULL, train_window TEXT NOT NULL,
      metrics_json TEXT NOT NULL, ablation_json TEXT NOT NULL, promoted INTEGER NOT NULL DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS model_backtests (
      model_version TEXT NOT NULL, season INTEGER NOT NULL, week INTEGER NOT NULL,
      metrics_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(model_version, season, week)
    )`);

    // Provider-level LLM accounting. This deliberately contains no credentials or prompt content.
    db.run(`CREATE TABLE IF NOT EXISTS llm_usage_daily (
      day TEXT NOT NULL, provider TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0, stories_summarized INTEGER NOT NULL DEFAULT 0,
      tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
      rate_limits INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, last_429_at TEXT, remaining_requests TEXT, remaining_tokens TEXT,
      reset_requests TEXT, reset_tokens TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(day, provider)
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_games_status ON games(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_stats_team ON team_stats(team_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_picks_backtest_week ON picks_backtest(season, week)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_model_backtests_week ON model_backtests(model_version, season, week)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_llm_usage_day ON llm_usage_daily(day)`);
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

const recordLlmUsage = async (day, provider, usage = {}) => run(`
  INSERT INTO llm_usage_daily (day, provider, requests, stories_summarized, tokens_in, tokens_out, rate_limits, errors, last_error, last_429_at, remaining_requests, remaining_tokens, reset_requests, reset_tokens, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(day, provider) DO UPDATE SET
    requests = requests + excluded.requests, stories_summarized = stories_summarized + excluded.stories_summarized,
    tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out,
    rate_limits = rate_limits + excluded.rate_limits, errors = errors + excluded.errors,
    last_error = COALESCE(excluded.last_error, llm_usage_daily.last_error), last_429_at = COALESCE(excluded.last_429_at, llm_usage_daily.last_429_at),
    remaining_requests = COALESCE(excluded.remaining_requests, llm_usage_daily.remaining_requests),
    remaining_tokens = COALESCE(excluded.remaining_tokens, llm_usage_daily.remaining_tokens),
    reset_requests = COALESCE(excluded.reset_requests, llm_usage_daily.reset_requests), reset_tokens = COALESCE(excluded.reset_tokens, llm_usage_daily.reset_tokens), updated_at = excluded.updated_at`,
  [day, provider, usage.requests || 0, usage.stories || 0, usage.tokens_in || 0, usage.tokens_out || 0, usage.rate_limits || 0, usage.errors || 0,
    usage.last_error || null, usage.last_429_at || null, usage.remaining_requests || null, usage.remaining_tokens || null,
    usage.reset_requests || null, usage.reset_tokens || null, new Date().toISOString()]);

const llmUsage = (days = 7) => all(`SELECT * FROM llm_usage_daily WHERE day >= ? ORDER BY day DESC, provider`, [new Date(Date.now() - (days - 1) * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })]);

module.exports = {
  db,
  saveDataset,
  loadDataset,
  initialize,
  run,
  get,
  all,
  recordLlmUsage,
  llmUsage
};
