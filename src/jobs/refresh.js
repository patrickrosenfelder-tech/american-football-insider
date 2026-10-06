const ratingService = require('../services/ratingService');
const injuryService = require('../services/injuryService');
const teamStatsService = require('../services/teamStatsService');
const tendencyService = require('../services/tendencyService');
const { currentSeason } = require('../services/rosterService');

const status = {};

const runJob = async (name, fn) => {
  const started = Date.now();
  status[name] = { ...(status[name] || {}), running: true, started_at: new Date(started).toISOString() };
  try {
    const result = await fn();
    status[name] = { running: false, ok: true, last_run: new Date().toISOString(), duration_ms: Date.now() - started, ...(result || {}) };
  } catch (error) {
    console.error(`[refresh] ${name} failed:`, error.message);
    status[name] = { ...status[name], running: false, ok: false, error: error.message, last_run: new Date().toISOString() };
  }
  return status[name];
};

// AFI ratings from nflverse season stats + snap counts.
const refreshRatings = () => runJob('ratings', async () => {
  const r = await ratingService.refreshRatings(currentSeason());
  return { data_through_week: r.data_through_week, rated_players: Object.keys(r.ratings).length };
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

// On boot: build anything missing (SQLite on Fly lives in /tmp, so a fresh machine starts empty).
const bootstrap = async () => {
  if (!(await ratingService.getRatings(currentSeason()))) await refreshRatings();
  if (!(await injuryService.getPracticeReport(currentSeason()))) await refreshPractice();
  if (!(await teamStatsService.getTeamStats(currentSeason())) || !(await tendencyService.getTendencies(currentSeason()))) await refreshPbpDerived();
  await refreshSchedules();
};

module.exports = { bootstrap, refreshRatings, refreshPractice, refreshPbpDerived, refreshSchedules, status };
