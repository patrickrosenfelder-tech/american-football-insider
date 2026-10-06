const playerStatsService = require('../services/playerStatsService');
const injuryService = require('../services/injuryService');
const teamStatsService = require('../services/teamStatsService');
const tendencyService = require('../services/tendencyService');
const newsService = require('../services/newsService');
const picksService = require('../services/picksService');
const rosterService = require('../services/rosterService');
const weatherService = require('../services/weatherService');
const sportsDataService = require('../services/sportsDataService');
const cache = require('../cache/cacheManager');
const db = require('../db/database');

const { currentSeason } = rosterService;

// Per-job run state. Persisted (datasets.job_status) so the status page and the scheduler's
// "last run" survive deploys. last_success / last_error are kept separately from the latest run.
const status = {};
const STATUS_KEY = 'job_status';

const loadStatus = async () => {
  const row = await db.loadDataset(STATUS_KEY).catch(() => null);
  Object.entries(row?.data || {}).forEach(([name, s]) => { status[name] = { ...s, running: false }; });
};

const saveStatus = () => db.saveDataset(STATUS_KEY, status).catch((error) => console.error('[refresh] status save failed:', error.message));

// A job may return { error } for a partial failure (e.g. 2 of 32 teams failed): the run still
// counts as a success, but the message is recorded as the last error.
const runJob = async (name, fn) => {
  const started = Date.now();
  const prev = status[name] || {};
  const keep = { last_success: prev.last_success || null, last_error: prev.last_error || null, last_error_at: prev.last_error_at || null };
  status[name] = { ...prev, running: true, started_at: new Date(started).toISOString() };
  try {
    const { error, ...result } = (await fn()) || {};
    const now = new Date().toISOString();
    status[name] = {
      ...keep, running: false, ok: true, last_run: now, last_success: now, duration_ms: Date.now() - started, ...result,
      ...(error ? { last_error: error, last_error_at: now } : {})
    };
  } catch (error) {
    console.error(`[refresh] ${name} failed:`, error.message);
    const now = new Date().toISOString();
    status[name] = { ...prev, ...keep, running: false, ok: false, last_run: now, last_error: error.message, last_error_at: now, duration_ms: Date.now() - started };
  }
  await saveStatus();
  return status[name];
};

// Run fn over items with a small concurrency limit; returns failures as [{ item, error }].
const eachLimited = async (items, limit, fn) => {
  const failures = [];
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item).catch((error) => failures.push({ item, error: error.message }));
    }
  }));
  return failures;
};

const partial = (failures, total, label) => {
  if (failures.length > total / 2) throw new Error(`${failures.length}/${total} ${label} failed: ${failures[0].error}`);
  return failures.length ? `${failures.length}/${total} ${label} failed (${failures.map((f) => f.item).join(', ')}): ${failures[0].error}` : undefined;
};

// ESPN rosters + depth charts for all 32 teams: bust the 6h cache and re-fetch.
const refreshRosters = () => runJob('rosters_depth', async () => {
  const teams = await sportsDataService.getTeams();
  const failures = await eachLimited(teams.map((t) => t.abbreviation), 4, async (abbr) => {
    const team = teams.find((t) => t.abbreviation === abbr);
    rosterService.bustTeam(team.id);
    await rosterService.getDepthChart(abbr);
  });
  return { teams: teams.length - failures.length, error: partial(failures, teams.length, 'teams') };
});

// ESPN league-wide injury feed.
const refreshInjuries = () => runJob('injuries', async () => {
  cache.del('injuries_league');
  const d = await injuryService.getLeagueInjuries();
  return { players: d.teams.reduce((n, t) => n + t.injuries.length, 0) };
});

// Open-Meteo kickoff forecasts for this week's games.
const refreshWeather = () => runJob('weather', async () => {
  const d = await weatherService.getWeekWeather();
  const failures = d.games.filter((g) => g.error).map((g) => ({ item: g.game_id, error: g.error }));
  return { week: d.week, games: d.games.length, error: partial(failures, d.games.length || 1, 'games') };
});

// ESPN scoreboard lines (spread / total / moneyline) for this week.
const refreshOdds = () => runJob('odds', async () => {
  const board = await sportsDataService.getUpcomingScoreboard();
  const upcoming = board.games.filter((g) => !g.status?.completed);
  return { week: board.week, games: upcoming.length, games_with_lines: upcoming.filter((g) => g.lines || g.odds).length };
});

// Player season stat lines from nflverse season stats + snap counts.
const refreshPlayerStats = () => runJob('player_stats', async () => {
  const r = await playerStatsService.refreshPlayerStats(currentSeason());
  return { data_through_week: r.data_through_week, players: Object.keys(r.stat_lines).length };
});

// Official practice participation (nflverse injuries_<season>.csv).
const refreshPractice = () => runJob('practice_report', async () => {
  const r = await injuryService.refreshPracticeReport(currentSeason());
  return { latest_week: r.latest_week, players: Object.keys(r.players).length };
});

// Play-by-play derived data: team comparison stats + scheme tendencies (pbp + FTN charting).
// One pbp download feeds both.
const refreshPbpDerived = () => runJob('pbp_derived', async () => {
  const season = currentSeason();
  const plays = await teamStatsService.loadPbp(season);
  const stats = await teamStatsService.refreshTeamStats(season, plays);
  const tendencies = await tendencyService.refreshTendencies(season, { plays, includeParticipation: false });
  return { data_through_week: stats.data_through_week, plays: plays.length, ftn_through_week: tendencies.sources.ftn?.through_week ?? null };
});

// Completed games since 1999 for head-to-head records.
const refreshSchedules = () => runJob('schedules', async () => {
  const rows = await teamStatsService.refreshSchedules();
  return { games: rows.length };
});

// News: headlines + data stories, then LLM summaries within the daily cap.
const refreshNews = () => runJob('news', async () => {
  const log = await newsService.runNews();
  const used = Object.fromEntries((log.llm?.providers || []).filter((p) => p.used).map((p) => [p.name, p.used]));
  return { summarized: log.summarized, providers_used: used, new_stories: log.new_stories, missing_keys: log.missing_keys };
});

// AFI Picks: re-pick unstarted games, lock started ones, grade finals.
const refreshPicks = () => runJob('picks', async () => picksService.refreshPicks());

// On boot: build anything missing (SQLite on Fly lives in /tmp, so a fresh machine starts empty).
const bootstrap = async () => {
  if (!(await playerStatsService.getPlayerStats(currentSeason()))) await refreshPlayerStats();
  if (!(await injuryService.getPracticeReport(currentSeason()))) await refreshPractice();
  if (!(await teamStatsService.getTeamStats(currentSeason())) || !(await tendencyService.getTendencies(currentSeason()))) await refreshPbpDerived();
  await refreshSchedules();
  await refreshNews();
};

module.exports = { bootstrap, loadStatus, refreshRosters, refreshInjuries, refreshWeather, refreshOdds, refreshNews, refreshPicks, refreshPlayerStats, refreshPractice, refreshPbpDerived, refreshSchedules, status };
