const db = require('../db/database');
const { assetUrl, streamCsv, num } = require('./nflverseService');

// nflverse uses a few abbreviations that differ from ESPN's.
const NFLVERSE_TO_ESPN = { LA: 'LAR', WAS: 'WSH' };
const ESPN_TO_NFLVERSE = { LAR: 'LA', WSH: 'WAS' };
const toEspn = (abbr) => NFLVERSE_TO_ESPN[abbr] || abbr;
const toNflverse = (abbr) => ESPN_TO_NFLVERSE[abbr] || abbr;

const PBP_COLUMNS = ['game_id', 'play_id', 'season_type', 'week', 'posteam', 'defteam', 'home_team', 'away_team', 'play_type',
  'yards_gained', 'pass', 'rush', 'interception', 'fumble_lost', 'down', 'third_down_converted', 'third_down_failed',
  'fixed_drive', 'fixed_drive_result', 'drive_inside20', 'total_home_score', 'total_away_score', 'epa', 'success',
  'qb_dropback', 'sack', 'shotgun', 'no_huddle', 'qb_scramble', 'game_seconds_remaining', 'drive', 'wp', 'half_seconds_remaining',
  'score_differential', 'qtr', 'passer_player_name', 'passer_player_id', 'receiver_player_name', 'receiver_player_id',
  'rusher_player_name', 'rusher_player_id', 'air_yards', 'complete_pass', 'incomplete_pass', 'pass_touchdown',
  'home_score', 'away_score', 'temp', 'wind', 'roof', 'surface', 'game_time'];

const pbpUrl = (season) => assetUrl('pbp', `play_by_play_${season}.csv.gz`);

// Streams a season of nflverse play-by-play (regular season only) into memory-light rows.
const loadPbp = async (season) => {
  const plays = [];
  await streamCsv(pbpUrl(season), (r) => {
    if (r.season_type !== 'REG') return;
    plays.push(r);
  }, { columns: PBP_COLUMNS });
  return plays;
};

const emptySide = () => ({ plays: 0, yards: 0, giveaways: 0, third_att: 0, third_conv: 0, rz_drives: 0, rz_tds: 0, epa: 0, epa_plays: 0, success: 0 });

// Per-team offense/defense from pbp: yards, points, turnovers, 3rd down, red zone, EPA.
const buildTeamStats = (plays) => {
  const teams = {};
  const games = {}; // game_id -> { home, away, home_score, away_score, week }
  const rzDrives = {}; // `${game}|${team}|${drive}` -> td?
  const team = (abbr) => {
    if (!teams[abbr]) teams[abbr] = { off: emptySide(), def: emptySide(), games: new Set() };
    return teams[abbr];
  };

  plays.forEach((p) => {
    const g = games[p.game_id] || (games[p.game_id] = { home: p.home_team, away: p.away_team, week: Number(p.week), home_score: 0, away_score: 0 });
    g.home_score = Math.max(g.home_score, num(p.total_home_score) || 0);
    g.away_score = Math.max(g.away_score, num(p.total_away_score) || 0);
    if (!p.posteam || !p.defteam) return;
    const off = team(p.posteam);
    const def = team(p.defteam);
    off.games.add(p.game_id);
    def.games.add(p.game_id);

    const isScrimmage = p.play_type === 'pass' || p.play_type === 'run';
    const yards = num(p.yards_gained) || 0;
    const giveaway = (num(p.interception) || 0) + (num(p.fumble_lost) || 0);
    if (!isScrimmage) return;
    [off.off, def.def].forEach((side) => {
      side.giveaways += giveaway; // offense: giveaways, defense: takeaways
      side.plays += 1;
      side.yards += yards;
      const epa = num(p.epa);
      if (epa != null) { side.epa += epa; side.epa_plays += 1; side.success += num(p.success) || 0; }
      if (p.down === '3') {
        side.third_att += 1;
        side.third_conv += num(p.third_down_converted) || 0;
      }
    });
  });
  plays.forEach((p) => {
    if (p.posteam && p.drive_inside20 === '1' && p.fixed_drive) {
      rzDrives[`${p.game_id}|${p.posteam}|${p.defteam}|${p.fixed_drive}`] = p.fixed_drive_result === 'Touchdown';
    }
  });

  Object.entries(rzDrives).forEach(([key, td]) => {
    const [, offTeam, defTeam] = key.split('|');
    team(offTeam).off.rz_drives += 1;
    team(defTeam).def.rz_drives += 1;
    if (td) { team(offTeam).off.rz_tds += 1; team(defTeam).def.rz_tds += 1; }
  });

  // Points from final scores.
  const points = {};
  Object.values(games).forEach((g) => {
    (points[g.home] ||= { pf: 0, pa: 0 });
    (points[g.away] ||= { pf: 0, pa: 0 });
    points[g.home].pf += g.home_score; points[g.home].pa += g.away_score;
    points[g.away].pf += g.away_score; points[g.away].pa += g.home_score;
  });

  const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
  const pct = (a, b) => (b ? round((100 * a) / b) : null);
  const out = {};
  Object.entries(teams).forEach(([abbr, t]) => {
    const gp = t.games.size;
    const side = (s, isOff) => ({
      yards_per_game: round(s.yards / gp),
      yards_per_play: round(s.yards / s.plays, 2),
      points_per_game: round((isOff ? points[abbr]?.pf : points[abbr]?.pa) / gp),
      turnovers: s.giveaways,
      third_down_pct: pct(s.third_conv, s.third_att),
      red_zone_td_pct: pct(s.rz_tds, s.rz_drives),
      epa_per_play: round(s.epa / s.epa_plays, 3),
      success_rate: pct(s.success, s.epa_plays)
    });
    out[toEspn(abbr)] = {
      games: gp,
      offense: side(t.off, true),
      defense: side(t.def, false),
      turnover_margin: t.def.giveaways - t.off.giveaways
    };
  });
  const maxWeek = Math.max(0, ...Object.values(games).map((g) => g.week));
  return { teams: out, data_through_week: maxWeek || null };
};

let memo = null;

const refreshTeamStats = async (season, plays = null) => {
  const rows = plays || await loadPbp(season);
  const result = { season, ...buildTeamStats(rows) };
  await db.saveDataset(`team_stats_${season}`, result, { data_through_week: result.data_through_week });
  memo = { ...result, updated_at: new Date().toISOString() };
  return memo;
};

const getTeamStats = async (season) => {
  if (memo && memo.season === season) return memo;
  const row = await db.loadDataset(`team_stats_${season}`);
  memo = row ? { ...row.data, updated_at: row.updated_at } : null;
  return memo;
};

// --- Head-to-head (nflverse schedules, 1999-present) ---------------------------

const GAMES_URL = 'https://github.com/nflverse/nfldata/raw/master/data/games.csv';
let h2hMemo = null;

const refreshSchedules = async () => {
  const rows = [];
  await streamCsv(GAMES_URL, (r) => {
    if (r.home_score === '' || r.away_score === '') return;
    rows.push({
      season: Number(r.season), week: Number(r.week), game_type: r.game_type, date: r.gameday,
      home: toEspn(r.home_team), away: toEspn(r.away_team),
      home_score: Number(r.home_score), away_score: Number(r.away_score), espn_id: r.espn || null,
      // Closing lines (spread_line > 0 = home favored), rest days, division game, neutral site.
      spread_line: num(r.spread_line), total_line: num(r.total_line), home_ml: num(r.home_moneyline), away_ml: num(r.away_moneyline),
      home_rest: num(r.home_rest), away_rest: num(r.away_rest), div_game: r.div_game === '1', neutral: r.location === 'Neutral'
    });
  }, { columns: ['season', 'week', 'game_type', 'gameday', 'home_team', 'away_team', 'home_score', 'away_score', 'espn', 'spread_line', 'total_line',
    'home_moneyline', 'away_moneyline', 'home_rest', 'away_rest', 'div_game', 'location'] });
  await db.saveDataset('schedules_played', rows, { games: rows.length });
  h2hMemo = rows;
  return rows;
};

const getPlayedGames = async () => {
  if (!h2hMemo) {
    const row = await db.loadDataset('schedules_played');
    h2hMemo = row ? row.data : null;
  }
  return h2hMemo;
};

const headToHead = async (a, b, limit = 5) => {
  if (!(await getPlayedGames())) return null;
  // Franchise moves: OAK->LV, SD->LAC, STL->LA(R).
  const alias = { LV: ['LV', 'OAK'], LAC: ['LAC', 'SD'], LAR: ['LAR', 'STL'] };
  const names = (t) => alias[t] || [t];
  const games = h2hMemo
    .filter((g) => (names(a).includes(g.home) && names(b).includes(g.away)) || (names(b).includes(g.home) && names(a).includes(g.away)))
    .sort((x, y) => y.date.localeCompare(x.date));
  const wins = { [a]: 0, [b]: 0, ties: 0 };
  games.forEach((g) => {
    const aHome = names(a).includes(g.home);
    const aScore = aHome ? g.home_score : g.away_score;
    const bScore = aHome ? g.away_score : g.home_score;
    if (aScore > bScore) wins[a] += 1; else if (bScore > aScore) wins[b] += 1; else wins.ties += 1;
  });
  return { all_time_since_1999: wins, total: games.length, recent: games.slice(0, limit) };
};

module.exports = {
  loadPbp,
  buildTeamStats,
  refreshTeamStats,
  getTeamStats,
  refreshSchedules,
  headToHead,
  getPlayedGames,
  toEspn,
  toNflverse,
  PBP_COLUMNS
};
