// Hourly logs that the model cannot get from history: betting-line movement and social sentiment.
// Neither is used by a model yet. They are collected now so they can be backtested after a season.
const db = require('../db/database');
const sportsDataService = require('./sportsDataService');
const socialService = require('./socialService');

// Snapshot times are rounded to the hour so a retried run cannot double-log.
const hourStamp = (d = new Date()) => { const t = new Date(d); t.setUTCMinutes(0, 0, 0); return t.toISOString(); };

const snapshotLines = async (now = new Date()) => {
  const board = await sportsDataService.getUpcomingScoreboard();
  const capturedAt = hourStamp(now);
  const upcoming = board.games.filter((g) => g.status?.state === 'pre' && g.lines);
  for (const g of upcoming) {
    const l = g.lines;
    await db.run(`INSERT OR REPLACE INTO line_snapshots (game_id, captured_at, season, week, kickoff, home, away, provider, spread_home, total,
      moneyline_home, moneyline_away, spread_home_open, total_open, moneyline_home_open, moneyline_away_open, minutes_to_kickoff)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      g.game_id, capturedAt, g.season ?? board.season ?? null, g.week ?? board.week ?? null, g.date, g.home?.abbreviation, g.away?.abbreviation,
      l.provider, l.spread_home, l.total, l.moneyline_home, l.moneyline_away, l.spread_home_open, l.total_open, l.moneyline_home_open,
      l.moneyline_away_open, Math.round((Date.parse(g.date) - now.getTime()) / 60000)
    ]);
  }
  return { captured_at: capturedAt, week: board.week, games: upcoming.length, skipped_without_lines: board.games.filter((g) => g.status?.state === 'pre' && !g.lines).length };
};

// Small football lexicon. Injury words count as negative and are also tallied on their own,
// since "out"/"IR" news is the part most likely to matter for a prediction.
const POSITIVE = /\b(win|wins|won|dominant|dominat\w*|return\w*|cleared|activated|healthy|extension|signs?|signed|breakout|record|upset|clutch|elite|statement)\b/gi;
const NEGATIVE = /\b(loss|lose|lost|benched|fired|suspended|suspension|arrest\w*|fumbl\w*|interception|struggl\w*|blowout|disaster|holdout|trade request|fine[ds]?)\b/gi;
const INJURY = /\b(injur\w*|out for|ruled out|doubtful|questionable|torn|acl|achilles|concussion|hamstring|ankle|knee|placed on ir|\bir\b|carted off|surgery)\b/gi;
const count = (re, text) => (String(text).match(re) || []).length;

const scorePost = (p) => {
  const text = [p.text, p.body, p.media?.title].filter(Boolean).join(' ');
  const injury = count(INJURY, text);
  const positive = count(POSITIVE, text);
  const negative = count(NEGATIVE, text) + injury;
  return { positive, negative, injury };
};

const snapshotSentiment = async (now = new Date()) => {
  const capturedAt = hourStamp(now);
  const prev = await db.get(`SELECT MAX(captured_at) AS at FROM sentiment_snapshots`).catch(() => null);
  const windowStart = prev?.at && prev.at < capturedAt ? prev.at : new Date(Date.parse(capturedAt) - 3600e3).toISOString();
  const { posts } = await socialService.list({ limit: 100000 });
  const recent = posts.filter((p) => p.published > windowStart && p.published <= now.toISOString() && p.teams?.length);
  const byTeam = {};
  for (const p of recent) {
    const s = scorePost(p);
    for (const team of p.teams) {
      const t = (byTeam[team] ||= { posts: 0, insider_posts: 0, positive: 0, negative: 0, injury_mentions: 0, platforms: {} });
      t.posts += 1; t.insider_posts += p.insider ? 1 : 0;
      t.positive += s.positive; t.negative += s.negative; t.injury_mentions += s.injury;
      t.platforms[p.platform] = (t.platforms[p.platform] || 0) + 1;
    }
  }
  for (const [team, t] of Object.entries(byTeam)) {
    // Score in [-1, 1]: share of sentiment words that are positive, centered.
    const words = t.positive + t.negative;
    const score = words ? (t.positive - t.negative) / words : 0;
    await db.run(`INSERT OR REPLACE INTO sentiment_snapshots (team, captured_at, window_start, posts, insider_posts, positive, negative, injury_mentions, score, platforms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [team, capturedAt, windowStart, t.posts, t.insider_posts, t.positive, t.negative, t.injury_mentions, Math.round(score * 1000) / 1000, JSON.stringify(t.platforms)]);
  }
  return { captured_at: capturedAt, window_start: windowStart, posts: recent.length, teams: Object.keys(byTeam).length };
};

const lineHistory = ({ season = null, week = null, gameId = null } = {}) => {
  const where = []; const params = [];
  if (gameId) { where.push('game_id = ?'); params.push(String(gameId)); }
  if (season) { where.push('season = ?'); params.push(Number(season)); }
  if (week) { where.push('week = ?'); params.push(Number(week)); }
  return db.all(`SELECT * FROM line_snapshots ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY game_id, captured_at`, params);
};

const sentimentHistory = ({ team = null, since = null } = {}) => {
  const where = []; const params = [];
  if (team) { where.push('team = ?'); params.push(String(team).toUpperCase()); }
  if (since) { where.push('captured_at >= ?'); params.push(String(since)); }
  return db.all(`SELECT * FROM sentiment_snapshots ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY captured_at, team`, params);
};

module.exports = { snapshotLines, snapshotSentiment, lineHistory, sentimentHistory, scorePost, hourStamp };
