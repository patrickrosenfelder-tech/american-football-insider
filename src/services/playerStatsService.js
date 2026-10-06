// Season stat lines per player (keyed by ESPN athlete id) from nflverse season stats + snap counts.
// Used by player pages and matchup previews (starting QB line).

const db = require('../db/database');
const { assetUrl, streamCsv, num, loadIdMap } = require('./nflverseService');

const STAT_COLUMNS = ['player_id', 'player_display_name', 'position', 'recent_team', 'games', 'completions', 'attempts',
  'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'sack_yards_lost', 'passing_epa', 'passing_cpoe',
  'carries', 'rushing_yards', 'rushing_tds', 'rushing_epa', 'receptions', 'targets', 'receiving_yards', 'receiving_tds',
  'receiving_epa', 'target_share', 'def_tackles_solo', 'def_tackle_assists', 'def_tackles_for_loss', 'def_fumbles_forced',
  'def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended', 'def_tds', 'fg_made', 'fg_att', 'fg_long', 'fg_pct',
  'fg_made_50_59', 'fg_made_60_', 'pat_made', 'pat_att', 'pt_att', 'pt_yards', 'pt_net_yards', 'pt_inside_20',
  'punt_returns', 'punt_return_yards', 'kickoff_returns', 'kickoff_return_yards'];

const buildPlayerStats = async (season) => {
  const idMap = await loadIdMap();

  const players = {}; // espn_id -> record
  const ensure = (espnId, base) => {
    if (!players[espnId]) players[espnId] = { espn_id: espnId, ...base };
    return players[espnId];
  };

  await streamCsv(assetUrl('stats_player', `stats_player_reg_${season}.csv`), (r) => {
    const ids = idMap.gsis[r.player_id];
    if (!ids) return;
    const p = ensure(ids.espn_id, { gsis_id: r.player_id, name: r.player_display_name, position: r.position, team: r.recent_team });
    for (const c of STAT_COLUMNS.slice(4)) p[c] = num(r[c]);
  }, { columns: STAT_COLUMNS });

  let maxWeek = 0;
  await streamCsv(assetUrl('snap_counts', `snap_counts_${season}.csv`), (r) => {
    if (r.game_type !== 'REG') return;
    const ids = idMap.pfr[r.pfr_player_id];
    if (!ids) return;
    maxWeek = Math.max(maxWeek, Number(r.week) || 0);
    const p = ensure(ids.espn_id, { name: r.player, position: r.position, team: r.team });
    p.snap_position = r.position;
    p.team = p.team || r.team;
    p.snap_games = (p.snap_games || 0) + 1;
    p.off_snaps = (p.off_snaps || 0) + (num(r.offense_snaps) || 0);
    p.def_snaps = (p.def_snaps || 0) + (num(r.defense_snaps) || 0);
    p.st_snaps = (p.st_snaps || 0) + (num(r.st_snaps) || 0);
    p.off_pct_sum = (p.off_pct_sum || 0) + (num(r.offense_pct) || 0);
    p.def_pct_sum = (p.def_pct_sum || 0) + (num(r.defense_pct) || 0);
  }, { columns: ['game_type', 'week', 'player', 'pfr_player_id', 'position', 'team', 'offense_snaps', 'offense_pct', 'defense_snaps', 'defense_pct', 'st_snaps'] });

  const statLines = {};
  Object.values(players).forEach((p) => {
    const line = { games: p.games || p.snap_games || 0, off_snaps: p.off_snaps || 0, def_snaps: p.def_snaps || 0, st_snaps: p.st_snaps || 0 };
    for (const c of STAT_COLUMNS.slice(5)) if (p[c] != null && p[c] !== 0) line[c] = p[c];
    statLines[p.espn_id] = line;
  });

  return { season, data_through_week: maxWeek || null, stat_lines: statLines };
};

let memo = null;

const refreshPlayerStats = async (season) => {
  const result = await buildPlayerStats(season);
  await db.saveDataset(`player_stats_${season}`, result, { data_through_week: result.data_through_week });
  memo = { ...result, updated_at: new Date().toISOString() };
  return memo;
};

const getPlayerStats = async (season) => {
  if (memo && memo.season === season) return memo;
  const row = await db.loadDataset(`player_stats_${season}`);
  if (!row) return null;
  memo = { ...row.data, updated_at: row.updated_at };
  return memo;
};

module.exports = { buildPlayerStats, refreshPlayerStats, getPlayerStats };
