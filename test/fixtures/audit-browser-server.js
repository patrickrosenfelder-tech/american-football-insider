// Deterministic browser smoke environment. No scheduler or external API calls.
// Run after npm run build: node test/fixtures/audit-browser-server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { renderMetadata } = require('../../src/services/pageMetadata');
const { presentPick } = require('../../src/services/pickPresentation');
const app = express();
const dist = path.join(__dirname, '../../client/dist');
const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const stamp = '2026-10-10T17:16:43Z';
const teams = [
  { id: '1', abbreviation: 'BUF', name: 'Buffalo Bills', short_name: 'Bills', record: '3-1', division: 'AFC East', conference: 'AFC', logo: '/favicon.svg' },
  { id: '2', abbreviation: 'JAX', name: 'Jacksonville Jaguars', short_name: 'Jaguars', record: '3-1', division: 'AFC South', conference: 'AFC', logo: '/favicon.svg' },
  { id: '3', abbreviation: 'PHI', name: 'Philadelphia Eagles', short_name: 'Eagles', record: '2-2', division: 'NFC East', conference: 'NFC', logo: '/favicon.svg' }
];
const game = { game_id: 'audit-game', week: 5, season: 2026, date: '2026-10-11T13:30:00Z', home: { ...teams[1], linescores: [], score: 24 }, away: { ...teams[2], linescores: [], score: 16 }, status: { state: 'pre', detail: 'Scheduled' }, team_stats: [], player_leaders: [], scoring_plays: [], news: [] };
const pick = presentPick({ home: 'JAX', away: 'PHI', model_version: 'v2.1.0', model_run_at: stamp, model: { home_margin: -6, home_win_prob: 33.1, total: 43.4 }, market: { spread_home: -7.5, total: 41.5, details: 'JAX -7.5' }, spread: { team: 'PHI', side: 'away', line: 7.5, confidence: 'high' }, total: { side: 'over', line: 41.5, confidence: 'low' }, moneyline: { team: 'PHI', model_prob: 66.9, implied_prob: 24.4, odds: 310 }, momentum: { home: { label: 'Hot', badge: '🔥' }, away: { label: 'Neutral', badge: '–' } } });
const r = { w: 1, l: 0, p: 0, text: '1-0', pct: 100 };
const record = { spread: r, total: r, moneyline: { ...r, w: 0, l: 1, text: '0-1', pct: 0 } };
const story = { id: 'audit-story', kind: 'headline', type: 'News', title: 'Bills prepare for Rams game', excerpt: 'Buffalo prepares for its Week 5 matchup.', summary: 'Buffalo prepares for its Week 5 matchup.', teams: ['BUF'], players: [], published: stamp, source_count: 1, sources: [{ name: 'Fixture source', title: 'Bills prepare for Rams game', url: 'https://example.com' }] };
let picksReads = 0;
app.get('/api/picks', (req, res) => {
  if (fs.existsSync(path.join(__dirname, '../../../fail-picks'))) return res.status(503).json({ success: false, error: 'Simulated upstream failure' });
  const refreshing = ++picksReads === 1;
  res.json({ success: true, data: { season: 2026, week: Number(req.query.week) || 5, games: [{ ...game, state: 'pre', pick }], record, confidence_record: [1, 2, 3, 4, 5].map((stars) => ({ stars, ...record })), weekly: [], disclaimer: 'For entertainment only. Not betting advice.', model_run: { available: true, generated_at: stamp, model_version: 'v2.1.0', games: 1 }, last_updated: stamp, refresh_in_progress: refreshing, stale: refreshing } });
});
app.get('/api/teams', (req, res) => res.json({ success: true, data: teams }));
app.get('/api/teams/:id', (req, res) => res.json({ success: true, data: { ...(teams.find((t) => t.abbreviation === req.params.id) || teams[0]), bye_week: 7, schedule: [], fetched_at: stamp } }));
app.get('/api/stats/team/:id', (req, res) => res.json({ success: true, data: { categories: {} } }));
app.get('/api/games', (req, res) => res.json({ success: true, data: [game], season: 2026, season_type: 2, week: 5, calendar: [], fetched_at: stamp }));
app.get('/api/games/:id', (req, res) => res.json({ success: true, data: { ...game, status: { state: 'post', detail: 'Final' }, fetched_at: stamp } }));
app.get('/api/previews/:id', (req, res) => res.json({ success: true, data: { ...game, status: 'pre', away: { ...game.away, recent_form: [], key_injuries: [] }, home: { ...game.home, recent_form: [], key_injuries: [] }, last_updated: stamp } }));
app.get('/api/news', (req, res) => res.json({ success: true, data: { stories: (!req.query.team || req.query.team.split(',').includes('BUF')) && (!req.query.q || 'bills prepare for rams game'.includes(req.query.q.toLowerCase())) ? [story] : [], headlines: [], last_updated: stamp } }));
app.get('/api/news/:id', (req, res) => res.json({ success: true, data: { ...story, teams: [teams[0]], related: [] } }));
app.get('/api/social', (req, res) => res.json({ success: true, data: { posts: [], accounts: [], platforms: [], last_updated: stamp } }));
app.get('/api/status', (req, res) => res.json({ success: true, data: { sources: [{ source: 'weather', label: 'Weather', provider: 'Open-Meteo', state: 'degraded', last_success: stamp, last_run: '2026-10-10T18:00:00Z', last_error: '3/15 games failed: HTTP 429', last_attempt_error: '3/15 games failed: HTTP 429', last_error_at: '2026-10-10T18:00:00Z' }], server_time: stamp } }));
const trend = { season: 2026, current: { su: r, ats: r, ou: r, home: { ats: r }, away: { ats: r }, favorite: { ats: r }, underdog: { ats: r }, last5: { ats: r, ou: r } }, previous: { season: 2025, ats: r, ou: r }, key_trends: [] };
app.get('/api/trends/game/:id', (req, res) => res.json({ success: true, data: { away: trend, home: trend } }));
app.get('/api/weather/game/:id', (req, res) => res.json({ success: true, data: { note: 'Forecast fixture', impact: { level: 'none', note: 'No impact' } } }));
app.get('/api/teams/:id/tendencies', (req, res) => res.json({ success: true, data: { current: null, reference: null } }));
app.get('/api/*', (req, res) => res.status(503).json({ success: false, error: 'No fixture for this optional section' }));
app.use(express.static(dist, { index: false }));
app.get('*', (req, res) => res.type('html').send(renderMetadata(template, req.path)));
app.listen(3018, '127.0.0.1', () => console.log('Audit browser fixtures: http://127.0.0.1:3018'));
