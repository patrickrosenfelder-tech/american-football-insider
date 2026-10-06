const ratingService = require('../services/ratingService');
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

// On boot: build anything missing (SQLite on Fly lives in /tmp, so a fresh machine starts empty).
const bootstrap = async () => {
  if (!(await ratingService.getRatings(currentSeason()))) await refreshRatings();
};

module.exports = { bootstrap, refreshRatings, status };
