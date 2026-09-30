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

  CREATE INDEX IF NOT EXISTS idx_games_week ON games (season, week, season_type);
  CREATE INDEX IF NOT EXISTS idx_stats_game ON player_stats (game_espn_id);
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
};
