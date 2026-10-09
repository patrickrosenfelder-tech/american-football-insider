const express = require('express');
const router = express.Router();
const scheduler = require('../jobs/scheduler');
const db = require('../db/database');
const { currentSeason } = require('../services/rosterService');
const newsService = require('../services/newsService');

// Public data-status view: one row per data source, built from the scheduler's job state.
// `dataset` is a fallback for last_success when a job has not run since status tracking began.
const SOURCES = [
  { key: 'rosters', label: 'Rosters', provider: 'ESPN', jobs: ['rosters_depth'] },
  { key: 'depth_charts', label: 'Depth charts', provider: 'ESPN', jobs: ['rosters_depth'] },
  { key: 'injuries', label: 'Injuries', provider: 'ESPN', jobs: ['injuries'] },
  { key: 'practice_report', label: 'Practice report', provider: 'nflverse', jobs: ['practice_report'], dataset: (s) => `practice_${s}` },
  { key: 'stats', label: 'Stats (players + teams)', provider: 'nflverse', jobs: ['player_stats', 'pbp_derived'], dataset: (s) => `player_stats_${s}` },
  { key: 'tendencies', label: 'Tendencies', provider: 'nflverse pbp + FTN', jobs: ['pbp_derived'], dataset: (s) => `tendencies_${s}` },
  { key: 'news', label: 'News', provider: 'RSS feeds + ESPN + LLM summaries', jobs: ['news'], dataset: () => 'news_v1' },
  { key: 'transactions', label: 'Trades & transactions', provider: 'nflverse trades.csv + ESPN transactions', jobs: ['transactions'], dataset: (s) => `trades_v3_${s}` },
  { key: 'trade_rumors', label: 'Trade rumors', provider: 'ProFootballRumors + Google News + AFI news feed', jobs: ['trade_rumors'], dataset: () => 'trade_rumors_v1' },
  { key: 'free_agents', label: 'Free agents', provider: 'ESPN transactions + athlete status, nflverse stats/snaps/rosters', jobs: ['free_agents'], dataset: (s) => `free_agents_${s}` },
  { key: 'weather', label: 'Weather', provider: 'Open-Meteo', jobs: ['weather'] },
  { key: 'odds', label: 'Odds / lines', provider: 'ESPN (DraftKings)', jobs: ['odds'] },
  { key: 'picks', label: 'AFI Picks', provider: 'AFI model', jobs: ['picks'] },
  { key: 'schedules', label: 'Head-to-head history', provider: 'nflverse', jobs: ['schedules'], dataset: () => 'schedules_played' }
];

// Details worth showing per job (counts, data-through week); everything else is bookkeeping.
const DETAIL_KEYS = ['data_through_week', 'ftn_through_week', 'latest_week', 'week', 'teams', 'players', 'games', 'games_with_lines', 'plays', 'summarized', 'new_stories', 'providers_used', 'missing_keys', 'trades', 'rumors', 'candidates', 'recently_signed'];

const latest = (values) => values.filter(Boolean).sort().pop() || null;
const earliest = (values) => values.filter(Boolean).sort()[0] || null;

const buildStatus = async () => {
  const jobs = Object.fromEntries(scheduler.describe().map((j) => [j.job, j]));
  const season = currentSeason();
  const sources = await Promise.all(SOURCES.map(async (src) => {
    const runs = src.jobs.map((name) => jobs[name] || { job: name });
    // A source is only as fresh as its stalest job.
    let lastSuccess = runs.every((r) => r.last_success) ? earliest(runs.map((r) => r.last_success)) : null;
    if (!lastSuccess && src.dataset) {
      const row = await db.loadDataset(src.dataset(season)).catch(() => null);
      lastSuccess = row?.updated_at || null;
    }
    const errorRun = runs.filter((r) => r.last_error).sort((a, b) => (b.last_error_at || '').localeCompare(a.last_error_at || ''))[0];
    const failing = runs.some((r) => r.ok === false);
    return {
      source: src.key,
      label: src.label,
      provider: src.provider,
      state: runs.some((r) => r.running) ? 'running' : failing ? 'error' : lastSuccess ? 'ok' : 'pending',
      last_success: lastSuccess,
      last_run: latest(runs.map((r) => r.last_run)),
      next_run: earliest(runs.map((r) => r.next_run)),
      schedule: runs.map((r) => r.when).filter(Boolean).join(' + '),
      last_error: errorRun?.last_error || null,
      last_error_at: errorRun?.last_error_at || null,
      jobs: runs.map((r) => ({
        job: r.job,
        when: r.when || null,
        ok: r.ok ?? null,
        last_success: r.last_success || null,
        next_run: r.next_run || null,
        duration_ms: r.duration_ms ?? null,
        details: Object.fromEntries(DETAIL_KEYS.filter((k) => r[k] != null).map((k) => [k, r[k]]))
      }))
    };
  }));
  const news = await newsService.status();
  const lastRun = news.runs?.[0] || {};
  const providers = lastRun.llm?.providers || [];
  const providerUsed = providers.find((p) => p.used)?.name || null;
  const providerHealth = news.llm.map((p) => ({ name: p.name, configured: p.configured, healthy: p.configured && !(providers.find((x) => x.name === p.name)?.stopped) }));
  return {
    sources,
    news_llm: {
      summarized_today: news.summarized_today,
      daily_cap: news.daily_cap,
      label: `${news.summarized_today}/${news.daily_cap} today`,
      provider_used_last_run: providerUsed,
      providers_healthy: providerHealth.every((p) => !p.configured || p.healthy),
      providers: providerHealth
    },
    last_updated: latest(sources.map((s) => s.last_success)), server_time: new Date().toISOString()
  };
};

// GET /api/status — per source: last successful update, next scheduled run, last error.
router.get('/', async (req, res) => {
  try {
    res.json({ success: true, data: await buildStatus(), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.buildStatus = buildStatus;
