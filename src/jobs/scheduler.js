// In-app scheduler (no external cron): checks every 10 minutes which jobs are due.
// Times are US Eastern. A job is due once its slot for today has passed and it has not run since.
// ESPN rosters/depth charts (6h) and injuries (1h) refresh on their own via cache TTL.

const refresh = require('./refresh');

const TICK_MS = 10 * 60 * 1000;

// days: 0=Sun..6=Sat (null = every day); hour: Eastern hour of day.
const SCHEDULE = [
  { job: 'practice_report', run: refresh.refreshPractice, days: null, hour: 7 },
  { job: 'player_stats', run: refresh.refreshPlayerStats, days: null, hour: 7 },
  // nflverse publishes pbp + FTN charting overnight after MNF, so tendencies/team stats run Tuesday.
  { job: 'pbp_derived', run: refresh.refreshPbpDerived, days: [2], hour: 8 },
  { job: 'schedules', run: refresh.refreshSchedules, days: [2], hour: 8 }
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

const isDue = (entry, now = eastern()) => {
  if (entry.days && !entry.days.includes(now.dow)) return false;
  if (now.hour < entry.hour) return false;
  const last = refresh.status[entry.job]?.last_run;
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
  setInterval(() => tick().catch((error) => console.error('[scheduler]', error.message)), TICK_MS).unref();
};

const describe = () => SCHEDULE.map(({ job, days, hour }) => ({
  job,
  when: `${days ? days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(',') : 'daily'} ${String(hour).padStart(2, '0')}:00 ET`,
  ...(refresh.status[job] || {})
}));

module.exports = { start, tick, register, describe, SCHEDULE };
