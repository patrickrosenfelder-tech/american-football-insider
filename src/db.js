const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const dir = path.dirname(config.dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    espn_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT,
    abbreviation TEXT,
    location TEXT,
    conference TEXT,
    division TEXT,
    logo_url TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    espn_id TEXT UNIQUE NOT NULL,
    season INTEGER,
    week INTEGER,
    season_type INTEGER,
    start_date TEXT,
    home_team_id TEXT,
    away_team_id TEXT,
    home_team_name TEXT,
    away_team_name TEXT,
    home_score INTEGER,
    away_score INTEGER,
    status_state TEXT,
    status_detail TEXT,
    period INTEGER,
    display_clock TEXT,
    venue TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_espn_id TEXT NOT NULL,
    team_espn_id TEXT,
    team_name TEXT,
    player_name TEXT NOT NULL,
    position TEXT,
    stat_category TEXT NOT NULL,
    stat_keys TEXT,
    stat_values TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(game_espn_id, player_name, stat_category)
  );

  -- A backtest row is immutable evidence for one historical prediction.  Live
  -- picks deliberately use a separate surface so they never inflate records.
  CREATE TABLE IF NOT EXISTS picks_backtest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_espn_id TEXT UNIQUE NOT NULL,
    season INTEGER NOT NULL,
    week INTEGER NOT NULL,
    kickoff TEXT,
    away_team TEXT NOT NULL,
    home_team TEXT NOT NULL,
    model_pick TEXT NOT NULL,
    model_margin REAL NOT NULL,
    confidence_stars INTEGER NOT NULL,
    closing_spread REAL,
    closing_total REAL,
    away_score INTEGER,
    home_score INTEGER,
    su_result TEXT,
    ats_result TEXT,
    ou_result TEXT,
    favorite_pick TEXT,
    favorite_su_result TEXT,
    home_pick TEXT,
    home_su_result TEXT,
    created_at TEXT NOT NULL
  );
`);

// The Fly volume predates the current MVP schema.  `CREATE TABLE IF NOT
// EXISTS` does not add columns to it, so make this migration explicit before
// creating indexes that depend on the column.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('games', 'season_type', 'INTEGER');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_games_week ON games (season, week, season_type);
  CREATE INDEX IF NOT EXISTS idx_stats_game ON player_stats (game_espn_id);
  CREATE INDEX IF NOT EXISTS idx_picks_backtest_week ON picks_backtest (season, week);
`);

const upsertTeamStmt = db.prepare(`
  INSERT INTO teams (espn_id, name, display_name, abbreviation, location, conference, division, logo_url, updated_at)
  VALUES (@espn_id, @name, @display_name, @abbreviation, @location, @conference, @division, @logo_url, @updated_at)
  ON CONFLICT(espn_id) DO UPDATE SET
    name = excluded.name,
    display_name = excluded.display_name,
    abbreviation = excluded.abbreviation,
    location = excluded.location,
    conference = excluded.conference,
    division = excluded.division,
    logo_url = excluded.logo_url,
    updated_at = excluded.updated_at
`);

const upsertGameStmt = db.prepare(`
  INSERT INTO games (espn_id, season, week, season_type, start_date, home_team_id, away_team_id,
    home_team_name, away_team_name, home_score, away_score, status_state, status_detail, period,
    display_clock, venue, updated_at)
  VALUES (@espn_id, @season, @week, @season_type, @start_date, @home_team_id, @away_team_id,
    @home_team_name, @away_team_name, @home_score, @away_score, @status_state, @status_detail, @period,
    @display_clock, @venue, @updated_at)
  ON CONFLICT(espn_id) DO UPDATE SET
    season = excluded.season,
    week = excluded.week,
    season_type = excluded.season_type,
    start_date = excluded.start_date,
    home_team_id = excluded.home_team_id,
    away_team_id = excluded.away_team_id,
    home_team_name = excluded.home_team_name,
    away_team_name = excluded.away_team_name,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    status_state = excluded.status_state,
    status_detail = excluded.status_detail,
    period = excluded.period,
    display_clock = excluded.display_clock,
    venue = excluded.venue,
    updated_at = excluded.updated_at
`);

const upsertPlayerStatStmt = db.prepare(`
  INSERT INTO player_stats (game_espn_id, team_espn_id, team_name, player_name, position, stat_category,
    stat_keys, stat_values, updated_at)
  VALUES (@game_espn_id, @team_espn_id, @team_name, @player_name, @position, @stat_category,
    @stat_keys, @stat_values, @updated_at)
  ON CONFLICT(game_espn_id, player_name, stat_category) DO UPDATE SET
    team_espn_id = excluded.team_espn_id,
    team_name = excluded.team_name,
    position = excluded.position,
    stat_keys = excluded.stat_keys,
    stat_values = excluded.stat_values,
    updated_at = excluded.updated_at
`);

function upsertTeam(team) {
  upsertTeamStmt.run(team);
}

function upsertGame(game) {
  upsertGameStmt.run(game);
}

function upsertPlayerStat(stat) {
  upsertPlayerStatStmt.run(stat);
}

function listTeams() {
  return db.prepare('SELECT * FROM teams ORDER BY display_name').all();
}

function getTeamByEspnId(espnId) {
  return db.prepare('SELECT * FROM teams WHERE espn_id = ?').get(espnId);
}

function listGames({ season, week, seasonType } = {}) {
  let query = 'SELECT * FROM games WHERE 1=1';
  const params = [];
  if (season) { query += ' AND season = ?'; params.push(season); }
  if (week) { query += ' AND week = ?'; params.push(week); }
  if (seasonType) { query += ' AND season_type = ?'; params.push(seasonType); }
  query += ' ORDER BY start_date';
  return db.prepare(query).all(...params);
}

function getGameByEspnId(espnId) {
  return db.prepare('SELECT * FROM games WHERE espn_id = ?').get(espnId);
}

function getPlayerStatsForGame(gameEspnId) {
  return db.prepare('SELECT * FROM player_stats WHERE game_espn_id = ? ORDER BY team_name, stat_category').all(gameEspnId);
}

const upsertBacktestStmt = db.prepare(`
  INSERT INTO picks_backtest (
    game_espn_id, season, week, kickoff, away_team, home_team, model_pick,
    model_margin, confidence_stars, closing_spread, closing_total, away_score,
    home_score, su_result, ats_result, ou_result, favorite_pick,
    favorite_su_result, home_pick, home_su_result, created_at
  ) VALUES (
    @game_espn_id, @season, @week, @kickoff, @away_team, @home_team, @model_pick,
    @model_margin, @confidence_stars, @closing_spread, @closing_total, @away_score,
    @home_score, @su_result, @ats_result, @ou_result, @favorite_pick,
    @favorite_su_result, @home_pick, @home_su_result, @created_at
  ) ON CONFLICT(game_espn_id) DO UPDATE SET
    model_pick = excluded.model_pick, model_margin = excluded.model_margin,
    confidence_stars = excluded.confidence_stars, closing_spread = excluded.closing_spread,
    closing_total = excluded.closing_total, away_score = excluded.away_score,
    home_score = excluded.home_score, su_result = excluded.su_result,
    ats_result = excluded.ats_result, ou_result = excluded.ou_result,
    favorite_pick = excluded.favorite_pick, favorite_su_result = excluded.favorite_su_result,
    home_pick = excluded.home_pick, home_su_result = excluded.home_su_result,
    created_at = excluded.created_at
`);

function upsertBacktest(row) { upsertBacktestStmt.run(row); }

function listBacktests(season = 2026) {
  return db.prepare('SELECT * FROM picks_backtest WHERE season = ? ORDER BY week, kickoff').all(season);
}

module.exports = {
  db,
  upsertTeam,
  upsertGame,
  upsertPlayerStat,
  listTeams,
  getTeamByEspnId,
  listGames,
  getGameByEspnId,
  getPlayerStatsForGame,
  upsertBacktest,
  listBacktests,
};
