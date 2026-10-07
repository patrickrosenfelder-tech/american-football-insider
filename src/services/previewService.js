const cache = require('../cache/cacheManager');
const { ESPN_SITE, fetchJson, getScoreboard, getStandings, getTeamDetail, findTeam } = require('./sportsDataService');
const rosterService = require('./rosterService');
const injuryService = require('./injuryService');
const playerStatsService = require('./playerStatsService');
const teamStatsService = require('./teamStatsService');
const { getMicroMatchups } = require('./microMatchupService');

const TTL_PREVIEW = 1800;

const standingFor = (standings, teamId) => {
  for (const conf of standings?.conferences || []) {
    for (const div of conf.divisions) {
      const i = div.teams.findIndex((t) => t.id === teamId);
      if (i !== -1) {
        const t = div.teams[i];
        const ord = ['1st', '2nd', '3rd', '4th'][i] || `${i + 1}th`;
        return {
          record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`,
          division: div.name,
          division_rank: ord,
          summary: `${ord} in ${div.name}`,
          playoff_seed: t.playoff_seed,
          streak: t.streak,
          points_for: t.points_for,
          points_against: t.points_against,
          home: t.home,
          road: t.road
        };
      }
    }
  }
  return null;
};

const recentForm = (schedule, teamId, limit = 5) => schedule
  .filter((g) => g.status.state === 'post')
  .slice(-limit)
  .reverse()
  .map((g) => {
    const us = g.home.id === teamId ? g.home : g.away;
    const them = g.home.id === teamId ? g.away : g.home;
    return {
      game_id: g.game_id,
      week: g.week,
      opponent: them.abbreviation,
      opponent_logo: them.logo,
      home: g.home.id === teamId,
      result: us.winner ? 'W' : them.winner ? 'L' : 'T',
      score: `${us.score}-${them.score}`
    };
  });

const UNAVAILABLE = ['Out', 'Injured Reserve', 'Doubtful', 'Suspension'];

// Projected starter = first QB on the depth chart who isn't Out/IR/Doubtful/Suspended.
const starterQb = (depth, playerStats) => {
  const slot = depth?.offense?.slots?.find((s) => s.key === 'qb');
  const players = slot?.players || [];
  if (!players.length) return null;
  const qb = players.find((p) => !UNAVAILABLE.includes(p.injury?.status)) || players[0];
  const line = playerStats?.stat_lines?.[qb.id] || {};
  return {
    id: qb.id,
    name: qb.name,
    headshot: qb.headshot,
    injury: qb.injury || null,
    replaces: qb !== players[0] ? { id: players[0].id, name: players[0].name, injury: players[0].injury } : null,
    season: {
      games: line.games ?? null,
      completions: line.completions ?? null,
      attempts: line.attempts ?? null,
      passing_yards: line.passing_yards ?? null,
      passing_tds: line.passing_tds ?? null,
      interceptions: line.passing_interceptions ?? null,
      rushing_yards: line.rushing_yards ?? null
    }
  };
};

// Keep the matchup builder independent of an additional depth-chart request.
// These are starters, not a claim that a player will shadow in coverage.
const featuredStarter = (depth, playerStats, keys) => {
  const slot = depth?.offense?.slots?.find((s) => keys.includes(String(s.key || '').toLowerCase()));
  const p = slot?.players?.[0];
  if (!p) return null;
  return { id: p.id, name: p.name, position: p.position, headshot: p.headshot, season: playerStats?.stat_lines?.[p.id] || {} };
};
const startingCorner = (depth, playerStats) => {
  const slot = depth?.defense?.slots?.find((s) => /^(cb|lcb|rcb)$/.test(String(s.key || '').toLowerCase()));
  const p = slot?.players?.[0];
  if (!p) return null;
  return { id: p.id, name: p.name, position: p.position, headshot: p.headshot, season: playerStats?.stat_lines?.[p.id] || {} };
};
const edgeRusher = (depth, playerStats) => {
  const slot = depth?.defense?.slots?.find((s) => /^(de|lde|rde|le|re|olb|wlb|slb|lb)$/.test(String(s.key || '').toLowerCase()));
  const p = slot?.players?.[0];
  if (!p) return null;
  return { id: p.id, name: p.name, position: p.position, headshot: p.headshot, season: playerStats?.stat_lines?.[p.id] || {} };
};

// Key injuries: Out/Doubtful/Questionable players, depth-chart starters first.
const keyInjuries = (injuries, depth, limit = 8) => {
  const starters = new Set();
  [depth?.offense, depth?.defense, depth?.special_teams].forEach((u) => (u?.slots || []).forEach((s) => {
    if (s.players[0]) starters.add(s.players[0].id);
  }));
  return (injuries || [])
    .filter((i) => ['Out', 'Doubtful', 'Questionable'].includes(i.status) || starters.has(i.athlete_id))
    .map((i) => ({ ...i, starter: starters.has(i.athlete_id) }))
    .sort((a, b) => Number(b.starter) - Number(a.starter) || injuryService.severity(a.status) - injuryService.severity(b.status))
    .slice(0, limit);
};

const oddsFrom = (summary) => {
  const p = summary.pickcenter?.[0];
  if (!p) return null;
  return {
    provider: p.provider?.name || null,
    details: p.details || null,
    spread: p.spread ?? null,
    over_under: p.overUnder ?? null,
    home_moneyline: p.homeTeamOdds?.moneyLine ?? null,
    away_moneyline: p.awayTeamOdds?.moneyLine ?? null,
    open_spread_home: p.pointSpread?.home?.open?.line ?? null,
    open_total: p.total?.over?.open?.line ? p.total.over.open.line.replace(/^o/, '') : null
  };
};

const sideFor = async (team, { standings, injuries, playerStats, teamStats, season }) => {
  const detail = await getTeamDetail(team.abbreviation).catch(() => null);
  const decorate = (a) => ({ ...a, injury: injuries.map[a.id] || null });
  const depth = await rosterService.getDepthChart(team.abbreviation, { decorate }).catch(() => null);
  return {
    id: team.id,
    abbreviation: team.abbreviation,
    name: team.name,
    logo: team.logo,
    color: team.color,
    standing: standingFor(standings, team.id),
    base_defense: depth?.base_defense || null,
    starting_qb: starterQb(depth, playerStats),
    wr1: featuredStarter(depth, playerStats, ['wr', 'wr1', 'lwr', 'rwr']),
    rb1: featuredStarter(depth, playerStats, ['rb', 'hb', 'fb']),
    cb1: startingCorner(depth, playerStats),
    edge_rusher: edgeRusher(depth, playerStats),
    key_injuries: keyInjuries(injuries.byTeam[team.id], depth),
    recent_form: detail ? recentForm(detail.schedule, team.id) : [],
    stats: teamStats?.teams?.[team.abbreviation] || null,
    season
  };
};

const buildPreview = async (gameId) => {
  let summary;
  try {
    summary = await fetchJson(`${ESPN_SITE}/summary`, { event: gameId });
  } catch (error) {
    if (error.response && [400, 404].includes(error.response.status)) return null;
    throw error;
  }
  const comp = summary.header?.competitions?.[0];
  if (!comp) return null;
  const season = summary.header.season?.year || rosterService.currentSeason();

  const [standings, league, playerStats, teamStats] = await Promise.all([
    getStandings().catch(() => null),
    injuryService.getLeagueInjuries().catch(() => ({ teams: [] })),
    playerStatsService.getPlayerStats(season),
    teamStatsService.getTeamStats(season)
  ]);
  const injuries = { map: {}, byTeam: {} };
  league.teams.forEach((t) => {
    injuries.byTeam[t.team.id] = t.injuries;
    t.injuries.forEach((i) => { if (i.athlete_id) injuries.map[i.athlete_id] = { status: i.status, injury: i.injury, practice: i.practice }; });
  });

  const home = comp.competitors.find((c) => c.homeAway === 'home');
  const away = comp.competitors.find((c) => c.homeAway === 'away');
  const [homeTeam, awayTeam] = await Promise.all([findTeam(home.team.id), findTeam(away.team.id)]);
  const ctx = { standings, injuries, playerStats, teamStats, season };
  const [homeSide, awaySide] = await Promise.all([sideFor(homeTeam, ctx), sideFor(awayTeam, ctx)]);
  const h2h = await teamStatsService.headToHead(awayTeam.abbreviation, homeTeam.abbreviation).catch(() => null);
  const micro_matchups = await getMicroMatchups({ season, home: homeTeam.abbreviation, away: awayTeam.abbreviation }).catch(() => []);

  return {
    game_id: gameId,
    season,
    week: summary.header.week ?? null,
    date: comp.date,
    status: comp.status?.type?.state || 'pre',
    status_detail: comp.status?.type?.shortDetail || null,
    venue: summary.gameInfo?.venue ? { name: summary.gameInfo.venue.fullName, city: summary.gameInfo.venue.address?.city, state: summary.gameInfo.venue.address?.state } : null,
    neutral_site: comp.neutralSite === true,
    broadcast: (comp.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean).join(', ') || null,
    away: awaySide,
    home: homeSide,
    odds: oddsFrom(summary),
    predictor: summary.predictor ? {
      home_win_pct: Number(summary.predictor.homeTeam?.gameProjection) || null,
      away_win_pct: Number(summary.predictor.awayTeam?.gameProjection) || null,
      source: 'ESPN Matchup Predictor'
    } : null,
    head_to_head: h2h,
    micro_matchups,
    team_stats_through_week: teamStats?.data_through_week ?? null,
    stats_through_week: playerStats?.data_through_week ?? null,
    last_updated: new Date().toISOString()
  };
};

const getPreview = (gameId) => cache.getOrSet(`preview_${gameId}`, () => buildPreview(gameId), TTL_PREVIEW);

// Upcoming games of a week (default: the next week with games not yet played).
const listPreviews = async ({ week, season, seasonType } = {}) => {
  let board = await getScoreboard({ week, season, seasonType });
  if (!week && board.games.length && board.games.every((g) => g.status.state === 'post')) {
    const next = board.calendar.find((b) => b.season_type === board.season_type)?.weeks.find((w) => w.week === board.week + 1);
    if (next) board = await getScoreboard({ week: next.week, season: board.season, seasonType: board.season_type });
  }
  return {
    season: board.season,
    season_type: board.season_type,
    week: board.week,
    teams_on_bye: board.teams_on_bye,
    games: board.games.map((g) => ({
      game_id: g.game_id,
      date: g.date,
      status: g.status,
      away: { id: g.away.id, abbreviation: g.away.abbreviation, name: g.away.name, logo: g.away.logo, record: g.away.record },
      home: { id: g.home.id, abbreviation: g.home.abbreviation, name: g.home.name, logo: g.home.logo, record: g.home.record },
      odds: g.odds,
      broadcast: g.broadcast,
      preview_url: `/api/previews/${g.game_id}`
    })),
    last_updated: board.fetched_at || null
  };
};

module.exports = { getPreview, listPreviews };
