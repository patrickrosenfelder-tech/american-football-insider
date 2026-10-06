const { getPlayedGames } = require('./teamStatsService');
const { currentSeason } = require('./rosterService');

// Betting trends computed from nflverse schedules (closing spread/total lines, results, rest days).
// spread_line > 0 means the home team was favored by that many points.

const perspective = (g, team) => {
  const home = g.home === team;
  const pf = home ? g.home_score : g.away_score;
  const pa = home ? g.away_score : g.home_score;
  const line = g.spread_line == null ? null : (home ? -g.spread_line : g.spread_line); // team's spread (negative = favored)
  const cover = line == null ? null : pf - pa + line;
  const total = g.home_score + g.away_score;
  return {
    season: g.season, week: g.week, date: g.date, game_type: g.game_type, opp: home ? g.away : g.home, home, neutral: g.neutral,
    pf, pa, su: pf > pa ? 'W' : pf < pa ? 'L' : 'T',
    line, ats: cover == null ? null : cover > 0 ? 'W' : cover < 0 ? 'L' : 'P',
    total_line: g.total_line, total, ou: g.total_line == null ? null : total > g.total_line ? 'O' : total < g.total_line ? 'U' : 'P',
    favorite: line == null ? null : line < 0, rest: home ? g.home_rest : g.away_rest, div: g.div_game
  };
};

const tally = (games, key, win, loss) => {
  const r = { w: 0, l: 0, p: 0 };
  games.forEach((g) => { if (g[key] === win) r.w += 1; else if (g[key] === loss) r.l += 1; else if (g[key] != null) r.p += 1; });
  r.n = r.w + r.l;
  r.pct = r.n ? Math.round((1000 * r.w) / r.n) / 10 : null;
  r.text = `${r.w}-${r.l}${r.p ? `-${r.p}` : ''}`;
  return r;
};

const splits = (games) => {
  const ats = (list) => tally(list, 'ats', 'W', 'L');
  const ou = (list) => tally(list, 'ou', 'O', 'U');
  const su = (list) => tally(list, 'su', 'W', 'L');
  const by = (fn) => games.filter(fn);
  const last5 = games.slice(-5);
  return {
    games: games.length,
    su: su(games),
    ats: ats(games),
    ou: ou(games),
    home: { su: su(by((g) => g.home && !g.neutral)), ats: ats(by((g) => g.home && !g.neutral)), ou: ou(by((g) => g.home && !g.neutral)) },
    away: { su: su(by((g) => !g.home || g.neutral)), ats: ats(by((g) => !g.home || g.neutral)), ou: ou(by((g) => !g.home || g.neutral)) },
    favorite: { ats: ats(by((g) => g.favorite === true)), su: su(by((g) => g.favorite === true)) },
    underdog: { ats: ats(by((g) => g.favorite === false)), su: su(by((g) => g.favorite === false)) },
    division: { ats: ats(by((g) => g.div)) },
    last5: { su: su(last5), ats: ats(last5), ou: ou(last5) },
    rest: {
      short: { label: 'Short rest (≤6 days)', ats: ats(by((g) => g.rest != null && g.rest <= 6)) },
      normal: { label: 'Normal rest (7 days)', ats: ats(by((g) => g.rest === 7)) },
      extra: { label: 'Extra rest (8+ days, incl. bye)', ats: ats(by((g) => g.rest != null && g.rest >= 8)) }
    },
    avg_margin: games.length ? Math.round((games.reduce((s, g) => s + g.pf - g.pa, 0) / games.length) * 10) / 10 : null,
    avg_total: games.length ? Math.round((games.reduce((s, g) => s + g.total, 0) / games.length) * 10) / 10 : null
  };
};

// Most notable records (far from 50%, enough games) as plain-language trends.
const keyTrends = (team, s, label) => {
  const c = [];
  const add = (rec, text) => { if (rec && rec.n >= 3) c.push({ text: text(rec), score: Math.abs(rec.w / rec.n - 0.5) * Math.sqrt(rec.n) }); };
  add(s.ats, (r) => `${team} is ${r.text} ATS ${label}.`);
  add(s.su, (r) => `${team} is ${r.text} straight up ${label}.`);
  add(s.ou, (r) => (r.w >= r.l ? `Overs are ${r.w}-${r.l}${r.p ? `-${r.p}` : ''} in ${team} games ${label}.` : `Unders are ${r.l}-${r.w}${r.p ? `-${r.p}` : ''} in ${team} games ${label}.`));
  add(s.home.ats, (r) => `${team} is ${r.text} ATS at home ${label}.`);
  add(s.away.ats, (r) => `${team} is ${r.text} ATS on the road ${label}.`);
  add(s.favorite.ats, (r) => `${team} is ${r.text} ATS as a favorite ${label}.`);
  add(s.underdog.ats, (r) => `${team} is ${r.text} ATS as an underdog ${label}.`);
  add(s.last5.ats, (r) => `${team} is ${r.text} ATS in its last ${r.n + r.p} games.`);
  return c.sort((a, b) => b.score - a.score);
};

const teamTrends = async (team, season = currentSeason()) => {
  const played = await getPlayedGames();
  if (!played) return null;
  const forSeason = (y) => played.filter((g) => g.season === y && g.game_type === 'REG' && (g.home === team || g.away === team))
    .sort((a, b) => a.date.localeCompare(b.date)).map((g) => perspective(g, team));
  const cur = forSeason(season);
  const prev = forSeason(season - 1);
  const curSplits = splits(cur);
  const prevSplits = splits(prev);
  return {
    team,
    season,
    current: curSplits,
    previous: { season: season - 1, ...prevSplits },
    games: cur.slice().reverse(),
    key_trends: [...keyTrends(team, curSplits, 'this season'), ...keyTrends(team, prevSplits, `in ${season - 1}`).map((t) => ({ ...t, score: t.score * 0.6 }))]
      .sort((a, b) => b.score - a.score).slice(0, 4).map((t) => t.text)
  };
};

module.exports = { teamTrends, perspective, splits };
