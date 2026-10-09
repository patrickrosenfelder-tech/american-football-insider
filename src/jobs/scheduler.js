// In-app scheduler (no external cron): checks every 10 minutes which jobs are due.
// Times are US Eastern. A job is due once its slot for today has passed and it has not run since.
// ESPN rosters/depth charts (6h) and injuries (1h) also refresh on demand via cache TTL; the jobs
// below re-warm them on a fixed schedule so the status page has a real last-success time.

const refresh = require('./refresh');

const TICK_MS = 10 * 60 * 1000;

// days: 0=Sun..6=Sat (null = every day); hour: Eastern hour of day; everyHours: interval jobs.
const SCHEDULE = [
  { job: 'rosters_depth', run: refresh.refreshRosters, days: null, hour: 5 },
  { job: 'injuries', run: refresh.refreshInjuries, everyHours: 1 },
  { job: 'odds', run: refresh.refreshOdds, everyHours: 1 },
  { job: 'weather', run: refresh.refreshWeather, everyHours: 3 },
  { job: 'practice_report', run: refresh.refreshPractice, days: null, hour: 7 },
  { job: 'player_stats', run: refresh.refreshPlayerStats, days: null, hour: 7 },
  // nflverse publishes pbp + FTN charting overnight after MNF, so tendencies/team stats run Tuesday.
  { job: 'pbp_derived', run: refresh.refreshPbpDerived, days: [2], hour: 8 },
  { job: 'schedules', run: refresh.refreshSchedules, days: null, hour: 6 },
  // Headlines every 3h; LLM summaries are capped at NEWS_DAILY_LLM_CAP (40) stories per day.
  { job: 'news', run: refresh.refreshNews, everyHours: 3 },
  { job: 'transactions', run: refresh.refreshTrades, everyHours: 1 },
  { job: 'free_agents', run: refresh.refreshFreeAgents, days: null, hour: 6 },
  { job: 'picks', run: refresh.refreshPicks, everyHours: 1 }
];

const eastern = (d = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hour12: false
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  };
};

const register = (entry) => SCHEDULE.push(entry);

let started = null;

// Earliest time the scheduler will start this job (ticks run every 10 minutes after boot).
const nextTick = (after) => {
  if (!started) return new Date(after);
  return new Date(started + Math.ceil((after - started) / TICK_MS) * TICK_MS);
};

const nextRun = (entry) => {
  const last = refresh.status[entry.job]?.last_run;
  if (entry.everyHours) return nextTick(Math.max(Date.now(), last ? Date.parse(last) + entry.everyHours * 3600e3 : 0));
  const lastDate = last ? eastern(new Date(last)).date : null;
  // Walk forward hour by hour (max 8 days) to the first slot on an allowed day not already run.
  const hour = 3600e3;
  for (let t = Math.floor(Date.now() / hour) * hour; t < Date.now() + 8 * 24 * hour; t += hour) {
    const e = eastern(new Date(t));
    if (e.hour < entry.hour || (entry.days && !entry.days.includes(e.dow)) || e.date === lastDate) continue;
    return nextTick(Math.max(t, Date.now()));
  }
  return null;
};

const isDue = (entry, now = eastern()) => {
  const last = refresh.status[entry.job]?.last_run;
  if (entry.everyHours) return !last || Date.now() - Date.parse(last) >= entry.everyHours * 3600e3;
  if (entry.days && !entry.days.includes(now.dow)) return false;
  if (now.hour < entry.hour) return false;
  return !last || eastern(new Date(last)).date !== now.date;
};

let running = false;
const tick = async () => {
  if (running) return;
  running = true;
  try {
    for (const entry of SCHEDULE) {
      if (isDue(entry) && !refresh.status[entry.job]?.running) {
        console.log(`[scheduler] running ${entry.job}`);
        await entry.run();
      }
    }
  } finally {
    running = false;
  }
};

const start = () => {
  started = Date.now();
  setInterval(() => tick().catch((error) => console.error('[scheduler]', error.message)), TICK_MS).unref();
};

const describe = () => SCHEDULE.map(({ job, days, hour, everyHours }) => ({
  job,
  when: everyHours ? `every ${everyHours}h` : `${days ? days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(',') : 'daily'} ${String(hour).padStart(2, '0')}:00 ET`,
  ...(refresh.status[job] || {}),
  next_run: nextRun(SCHEDULE.find((s) => s.job === job))?.toISOString() || null
}));

module.exports = { start, tick, register, describe, SCHEDULE };
