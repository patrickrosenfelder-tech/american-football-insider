// AFI rating (0-99): our own player rating built only from public season stats and snap
// counts (nflverse). It is NOT an EA Madden rating. Formula (documented in README):
//
//   1. Players are grouped by position (QB, RB, WR, TE, OL, DL, LB, DB, K, P).
//   2. Each group has a few production metrics with weights (METRICS below). A player's
//      metric score is his percentile rank among qualified players in that group (0..1).
//   3. production = weighted average of metric percentiles.
//      composite  = 0.75 * production + 0.25 * snap-share percentile   (K/P: production only;
//      OL has no individual stats, so it uses snap share + team pass-pro and run-game context).
//   4. AFI = round(40 + 59 * composite), so the range is 40-99.
//   Players below the qualifying sample (QUALIFY) get no rating ("NR").

const db = require('../db/database');
const { assetUrl, streamCsv, num, loadIdMap } = require('./nflverseService');

const GROUP_BY_POSITION = {
  QB: 'QB',
  RB: 'RB', HB: 'RB', FB: 'RB',
  WR: 'WR',
  TE: 'TE',
  T: 'OL', OT: 'OL', G: 'OL', OG: 'OL', C: 'OL', OL: 'OL', IOL: 'OL',
  DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', EDGE: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
  CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', DB: 'DB', SAF: 'DB',
  K: 'K', PK: 'K',
  P: 'P'
};

const perGame = (v, s) => (s.games ? (v || 0) / s.games : null);
const ratio = (a, b) => (b ? (a || 0) / b : null);

const METRICS = {
  QB: [
    ['EPA per dropback', 0.35, (s) => ratio(s.passing_epa, (s.attempts || 0) + (s.sacks_suffered || 0))],
    ['ANY/A', 0.3, (s) => ratio((s.passing_yards || 0) + 20 * (s.passing_tds || 0) - 45 * (s.passing_interceptions || 0) - (s.sack_yards_lost || 0), (s.attempts || 0) + (s.sacks_suffered || 0))],
    ['CPOE', 0.2, (s) => s.passing_cpoe],
    ['Rush yds/game', 0.15, (s) => perGame(s.rushing_yards, s)]
  ],
  RB: [
    ['Rush yds/game', 0.3, (s) => perGame(s.rushing_yards, s)],
    ['Rush EPA/carry', 0.2, (s) => ratio(s.rushing_epa, s.carries)],
    ['Yds/carry', 0.15, (s) => ratio(s.rushing_yards, s.carries)],
    ['Rec yds/game', 0.2, (s) => perGame(s.receiving_yards, s)],
    ['TD/game', 0.15, (s) => perGame((s.rushing_tds || 0) + (s.receiving_tds || 0), s)]
  ],
  WR: [
    ['Rec yds/game', 0.35, (s) => perGame(s.receiving_yards, s)],
    ['Yds/target', 0.2, (s) => ratio(s.receiving_yards, s.targets)],
    ['Rec EPA/target', 0.2, (s) => ratio(s.receiving_epa, s.targets)],
    ['Target share', 0.15, (s) => s.target_share],
    ['TD/game', 0.1, (s) => perGame(s.receiving_tds, s)]
  ],
  DL: [
    ['Sacks/game', 0.3, (s) => perGame(s.def_sacks, s)],
    ['QB hits/game', 0.25, (s) => perGame(s.def_qb_hits, s)],
    ['TFL/game', 0.25, (s) => perGame(s.def_tackles_for_loss, s)],
    ['Tackles/game', 0.1, (s) => perGame((s.def_tackles_solo || 0) + (s.def_tackle_assists || 0), s)],
    ['Forced fumbles', 0.1, (s) => s.def_fumbles_forced || 0]
  ],
  LB: [
    ['Tackles/game', 0.35, (s) => perGame((s.def_tackles_solo || 0) + (s.def_tackle_assists || 0), s)],
    ['TFL/game', 0.2, (s) => perGame(s.def_tackles_for_loss, s)],
    ['Sacks + QB hits/game', 0.15, (s) => perGame((s.def_sacks || 0) + (s.def_qb_hits || 0), s)],
    ['Passes defended', 0.15, (s) => s.def_pass_defended || 0],
    ['INT + FF', 0.15, (s) => (s.def_interceptions || 0) + (s.def_fumbles_forced || 0)]
  ],
  DB: [
    ['Passes defended/game', 0.35, (s) => perGame(s.def_pass_defended, s)],
    ['Interceptions', 0.25, (s) => s.def_interceptions || 0],
    ['Tackles/game', 0.2, (s) => perGame((s.def_tackles_solo || 0) + (s.def_tackle_assists || 0), s)],
    ['TFL', 0.1, (s) => s.def_tackles_for_loss || 0],
    ['Forced fumbles', 0.1, (s) => s.def_fumbles_forced || 0]
  ],
  K: [
    ['FG %', 0.5, (s) => ratio(s.fg_made, s.fg_att)],
    ['50+ FG made', 0.2, (s) => (s.fg_made_50_59 || 0) + (s.fg_made_60_ || 0)],
    ['PAT %', 0.3, (s) => ratio(s.pat_made, s.pat_att)]
  ],
  P: [
    ['Net yds/punt', 0.6, (s) => ratio(s.pt_net_yards, s.pt_att)],
    ['Inside-20 rate', 0.4, (s) => ratio(s.pt_inside_20, s.pt_att)]
  ],
  OL: [
    ['Team sack rate (inverse)', 0.5, (s) => (s.team_sack_rate != null ? -s.team_sack_rate : null)],
    ['Team rush EPA/carry', 0.5, (s) => s.team_rush_epa]
  ]
};
METRICS.TE = METRICS.WR;

const QUALIFY = {
  QB: (s) => (s.attempts || 0) >= 40,
  RB: (s) => (s.carries || 0) + (s.targets || 0) >= 15,
  WR: (s) => (s.targets || 0) >= 8,
  TE: (s) => (s.targets || 0) >= 5,
  OL: (s) => (s.off_snaps || 0) >= 60,
  DL: (s) => (s.def_snaps || 0) >= 50,
  LB: (s) => (s.def_snaps || 0) >= 50,
  DB: (s) => (s.def_snaps || 0) >= 50,
  K: (s) => (s.fg_att || 0) + (s.pat_att || 0) >= 4,
  P: (s) => (s.pt_att || 0) >= 5
};

const PRODUCTION_WEIGHT = { K: 1, P: 1, OL: 0.4 };

const STAT_COLUMNS = ['player_id', 'player_display_name', 'position', 'recent_team', 'games', 'completions', 'attempts',
  'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'sack_yards_lost', 'passing_epa', 'passing_cpoe',
  'carries', 'rushing_yards', 'rushing_tds', 'rushing_epa', 'receptions', 'targets', 'receiving_yards', 'receiving_tds',
  'receiving_epa', 'target_share', 'def_tackles_solo', 'def_tackle_assists', 'def_tackles_for_loss', 'def_fumbles_forced',
  'def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended', 'def_tds', 'fg_made', 'fg_att', 'fg_long', 'fg_pct',
  'fg_made_50_59', 'fg_made_60_', 'pat_made', 'pat_att', 'pt_att', 'pt_yards', 'pt_net_yards', 'pt_inside_20',
  'punt_returns', 'punt_return_yards', 'kickoff_returns', 'kickoff_return_yards'];

const percentileRank = (values) => {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  return (v) => {
    if (v == null || !sorted.length) return null;
    if (sorted.length === 1) return 0.5;
    let lo = 0;
    while (lo < sorted.length && sorted[lo] < v) lo += 1;
    let hi = lo;
    while (hi < sorted.length && sorted[hi] === v) hi += 1;
    return ((lo + hi - 1) / 2) / (sorted.length - 1);
  };
};

// Loads season stats, snap counts and the player ID map, then computes ratings for every player.
const buildRatings = async (season) => {
  // Team context for OL (no individual OL stats are public): sack rate allowed and rush EPA/carry.
  const teamContext = {};
  await streamCsv(assetUrl('stats_team', `stats_team_reg_${season}.csv`), (r) => {
    const dropbacks = (num(r.attempts) || 0) + (num(r.sacks_suffered) || 0);
    teamContext[r.team] = {
      sack_rate: dropbacks ? (num(r.sacks_suffered) || 0) / dropbacks : null,
      rush_epa: num(r.carries) ? (num(r.rushing_epa) || 0) / num(r.carries) : null
    };
  }, { columns: ['team', 'attempts', 'sacks_suffered', 'carries', 'rushing_epa'] });

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

  const list = Object.values(players).map((p) => {
    const group = GROUP_BY_POSITION[p.position] || GROUP_BY_POSITION[p.snap_position] || null;
    const games = p.games || p.snap_games || 0;
    const ctx = teamContext[p.team] || {};
    const isOffense = ['QB', 'RB', 'WR', 'TE', 'OL'].includes(group);
    const pctSum = isOffense ? p.off_pct_sum : p.def_pct_sum;
    return {
      ...p,
      group,
      games,
      snap_share: p.snap_games ? (pctSum || 0) / p.snap_games : null,
      team_sack_rate: ctx.sack_rate ?? null,
      team_rush_epa: ctx.rush_epa ?? null
    };
  });

  const ratings = {};
  Object.keys(METRICS).forEach((group) => {
    const qualified = list.filter((p) => p.group === group && QUALIFY[group](p));
    if (!qualified.length) return;
    const metricFns = METRICS[group].map(([label, weight, fn]) => {
      const values = qualified.map(fn);
      return { label, weight, fn, rank: percentileRank(values) };
    });
    const snapRank = percentileRank(qualified.map((p) => p.snap_share));
    const prodWeight = PRODUCTION_WEIGHT[group] ?? 0.75;

    qualified.forEach((p) => {
      let wSum = 0;
      let score = 0;
      const components = metricFns.map((m) => {
        const raw = m.fn(p);
        const pct = m.rank(raw);
        if (pct != null) { wSum += m.weight; score += m.weight * pct; }
        return { metric: m.label, weight: m.weight, value: raw == null ? null : Math.round(raw * 1000) / 1000, percentile: pct == null ? null : Math.round(pct * 100) };
      });
      const production = wSum ? score / wSum : 0;
      const snapPct = snapRank(p.snap_share);
      const composite = prodWeight >= 1 || snapPct == null ? production : prodWeight * production + (1 - prodWeight) * snapPct;
      ratings[p.espn_id] = {
        espn_id: p.espn_id,
        name: p.name,
        team: p.team,
        group,
        rating: Math.max(40, Math.min(99, Math.round(40 + 59 * composite))),
        production: Math.round(production * 100),
        snap_share: p.snap_share == null ? null : Math.round(p.snap_share * 100),
        snap_percentile: snapPct == null ? null : Math.round(snapPct * 100),
        components
      };
    });
  });

  // Season stat lines for player pages (keyed by ESPN id).
  const statLines = {};
  list.forEach((p) => {
    const line = { games: p.games, off_snaps: p.off_snaps || 0, def_snaps: p.def_snaps || 0, st_snaps: p.st_snaps || 0 };
    for (const c of STAT_COLUMNS.slice(5)) if (p[c] != null && p[c] !== 0) line[c] = p[c];
    statLines[p.espn_id] = line;
  });

  return { season, data_through_week: maxWeek || null, ratings, stat_lines: statLines };
};

let memo = null;

const refreshRatings = async (season) => {
  const result = await buildRatings(season);
  await db.saveDataset(`ratings_${season}`, result, { data_through_week: result.data_through_week });
  memo = { ...result, updated_at: new Date().toISOString() };
  console.log(`AFI ratings built: ${Object.keys(result.ratings).length} rated players, data through week ${result.data_through_week}`);
  return memo;
};

const getRatings = async (season) => {
  if (memo && memo.season === season) return memo;
  const row = await db.loadDataset(`ratings_${season}`);
  if (!row) return null;
  memo = { ...row.data, updated_at: row.updated_at };
  return memo;
};

module.exports = {
  buildRatings,
  refreshRatings,
  getRatings,
  GROUP_BY_POSITION,
  METRICS,
  QUALIFY
};
