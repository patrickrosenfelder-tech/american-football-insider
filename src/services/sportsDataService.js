const axios = require('axios');
const cache = require('../cache/cacheManager');

// ESPN's public (keyless) JSON endpoints. Unofficial but stable and widely used.
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';

const http = axios.create({
  timeout: 10000,
  headers: { 'User-Agent': 'American-Football-Insider/1.0' }
});

const TTL = {
  live: 30,
  scoreboard: 300,
  standings: 600,
  teams: 3600,
  stats: 1800,
  finalGame: 3600
};

const fetchJson = async (url, params = {}) => {
  const { data } = await http.get(url, { params });
  return data;
};

// --- Normalizers -----------------------------------------------------------

const normalizeTeamRef = (t = {}) => ({
  id: t.id,
  abbreviation: t.abbreviation,
  name: t.displayName,
  short_name: t.shortDisplayName || t.name,
  location: t.location,
  color: t.color ? `#${t.color}` : null,
  alternate_color: t.alternateColor ? `#${t.alternateColor}` : null,
  logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || null
});

const scoreValue = (score) => {
  if (score == null) return null;
  if (typeof score === 'object') return score.value != null ? Number(score.value) : null;
  const n = Number(score);
  return Number.isNaN(n) ? null : n;
};

const normalizeCompetitor = (c = {}) => ({
  ...normalizeTeamRef(c.team),
  home_away: c.homeAway,
  score: scoreValue(c.score),
  winner: c.winner === true,
  record: (c.records || []).find((r) => r.type === 'total' || r.name === 'overall')?.summary
    || (c.records && c.records[0] && c.records[0].summary)
    || (c.record && c.record[0] && c.record[0].displayValue)
    || null,
  linescores: (c.linescores || []).map((l) => Number(l.value ?? l.displayValue))
});

const statusFrom = (s = {}) => {
  const type = s.type || {};
  return {
    state: type.state || 'pre', // pre | in | post
    completed: type.completed === true,
    detail: type.shortDetail || type.detail || type.description || '',
    clock: s.displayClock || null,
    period: s.period || null
  };
};

const normalizeEvent = (e) => {
  const comp = (e.competitions && e.competitions[0]) || {};
  const competitors = (comp.competitors || []).map(normalizeCompetitor);
  const home = competitors.find((c) => c.home_away === 'home') || competitors[0] || {};
  const away = competitors.find((c) => c.home_away === 'away') || competitors[1] || {};
  const status = statusFrom(comp.status || e.status);
  const situation = comp.situation || null;

  return {
    game_id: e.id,
    name: e.name,
    short_name: e.shortName,
    season: e.season?.year,
    season_type: e.season?.type,
    week: e.week?.number ?? null,
    date: e.date,
    status,
    home,
    away,
    venue: comp.venue ? { name: comp.venue.fullName, city: comp.venue.address?.city, state: comp.venue.address?.state } : null,
    neutral_site: comp.neutralSite === true,
    broadcast: (comp.broadcasts || []).flatMap((b) => b.names || []).join(', ') || null,
    possession: situation?.possession || null,
    down_distance: situation?.downDistanceText || null,
    last_play: situation?.lastPlay?.text || null,
    leaders: (comp.leaders || []).map((l) => ({
      category: l.displayName,
      athlete: l.leaders?.[0]?.athlete?.displayName,
      team_id: l.leaders?.[0]?.team?.id,
      value: l.leaders?.[0]?.displayValue
    })).filter((l) => l.athlete),
    odds: comp.odds?.[0]?.details || null,
    lines: linesFrom(comp.odds?.[0])
  };
};

const mlNum = (v) => {
  if (v == null || v === '' || v === 'OFF') return null;
  if (String(v).toUpperCase() === 'EVEN') return 100;
  const n = Number(String(v).replace('+', ''));
  return Number.isNaN(n) ? null : n;
};

// Structured betting lines from ESPN's competition odds (DraftKings feed). spread_home < 0 = home favored.
const linesFrom = (o) => {
  if (!o) return null;
  const spread = o.pointSpread?.home?.close?.line ?? o.pointSpread?.home?.open?.line;
  const spreadHome = spread != null && spread !== '' ? Number(String(spread).replace('+', '')) : (o.spread != null ? Number(o.spread) : null);
  return {
    provider: o.provider?.name || null,
    details: o.details || null,
    spread_home: Number.isNaN(spreadHome) ? null : spreadHome,
    total: o.overUnder != null ? Number(o.overUnder) : null,
    moneyline_home: mlNum(o.moneyline?.home?.close?.odds ?? o.moneyline?.home?.open?.odds),
    moneyline_away: mlNum(o.moneyline?.away?.close?.odds ?? o.moneyline?.away?.open?.odds)
  };
};

const hasLiveGame = (games) => games.some((g) => g.status.state === 'in');

// --- Scoreboard / games ----------------------------------------------------

const getScoreboard = async ({ week, season, seasonType } = {}) => {
  const params = {};
  if (week) params.week = week;
  if (season) params.dates = season;
  if (seasonType) params.seasontype = seasonType;
  const cacheKey = `scoreboard_${week || 'cur'}_${season || 'cur'}_${seasonType || 'cur'}`;

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await fetchJson(`${ESPN_SITE}/scoreboard`, params);
  const games = (data.events || []).map(normalizeEvent).sort((a, b) => new Date(a.date) - new Date(b.date));
  const calendar = (data.leagues?.[0]?.calendar || []).map((block) => ({
    season_type: Number(block.value),
    label: block.label,
    weeks: (block.entries || []).map((w) => ({
      week: Number(w.value),
      label: w.label,
      detail: w.detail,
      start: w.startDate,
      end: w.endDate
    }))
  }));

  const result = {
    season: data.season?.year,
    season_type: data.season?.type,
    week: data.week?.number,
    teams_on_bye: (data.week?.teamsOnBye || []).map(normalizeTeamRef),
    calendar,
    games
  };
  cache.set(cacheKey, result, hasLiveGame(games) ? TTL.live : TTL.scoreboard);
  return result;
};

const getGames = async (week = null, season = null, seasonType = null) => {
  const board = await getScoreboard({ week, season, seasonType });
  return board.games;
};

const getGameDetail = async (gameId) => {
  const cacheKey = `game_${gameId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let data;
  try {
    data = await fetchJson(`${ESPN_SITE}/summary`, { event: gameId });
  } catch (error) {
    if (error.response && [400, 404].includes(error.response.status)) return null;
    throw error;
  }
  const headerComp = data.header?.competitions?.[0];
  if (!headerComp) return null;

  const event = normalizeEvent({
    id: data.header.id,
    name: headerComp.competitors?.map((c) => c.team?.displayName).reverse().join(' at '),
    shortName: headerComp.competitors?.map((c) => c.team?.abbreviation).reverse().join(' @ '),
    season: data.header.season,
    week: { number: data.header.week },
    date: headerComp.date,
    competitions: [{ ...headerComp, venue: data.gameInfo?.venue, situation: data.situation }]
  });

  const result = {
    ...event,
    team_stats: (data.boxscore?.teams || []).map((t) => ({
      team: normalizeTeamRef(t.team),
      stats: (t.statistics || []).map((s) => ({ name: s.name, label: s.label, value: s.displayValue }))
    })),
    player_leaders: (data.leaders || []).map((t) => ({
      team: normalizeTeamRef(t.team),
      categories: (t.leaders || []).map((cat) => ({
        category: cat.displayName,
        athlete: cat.leaders?.[0]?.athlete?.displayName,
        headshot: cat.leaders?.[0]?.athlete?.headshot?.href || null,
        value: cat.leaders?.[0]?.displayValue
      })).filter((c) => c.athlete)
    })),
    scoring_plays: (data.scoringPlays || []).map((p) => ({
      id: p.id,
      period: p.period?.number,
      clock: p.clock?.displayValue,
      type: p.scoringType?.displayName || p.type?.text,
      text: p.text,
      team: p.team ? { id: p.team.id, abbreviation: p.team.abbreviation, logo: p.team.logo } : null,
      away_score: p.awayScore,
      home_score: p.homeScore
    })),
    odds: data.pickcenter?.[0]?.details || event.odds,
    attendance: data.gameInfo?.attendance || null,
    weather: data.gameInfo?.weather ? `${data.gameInfo.weather.temperature ?? ''}°F ${data.gameInfo.weather.displayValue || ''}`.trim() : null,
    news: (data.news?.articles || []).slice(0, 5).map((a) => ({
      headline: a.headline,
      description: a.description,
      url: a.links?.web?.href || null,
      published: a.published
    }))
  };

  cache.set(cacheKey, result, result.status.state === 'post' ? TTL.finalGame : TTL.live);
  return result;
};

// Kept for backwards compatibility with the original API surface.
const getGameScore = getGameDetail;

// --- Standings / teams -----------------------------------------------------

const statMap = (stats = []) => stats.reduce((acc, s) => {
  acc[s.name] = s.displayValue;
  return acc;
}, {});

const getStandings = async () => cache.getOrSet('standings', async () => {
  const data = await fetchJson(ESPN_STANDINGS, { level: 3 });
  const conferences = (data.children || []).map((conf) => ({
    name: conf.name,
    abbreviation: conf.abbreviation,
    divisions: (conf.children || []).map((div) => ({
      name: div.name,
      teams: (div.standings?.entries || []).map((entry) => {
        const s = statMap(entry.stats);
        return {
          ...normalizeTeamRef({ ...entry.team, logo: entry.team.logos?.[0]?.href }),
          wins: Number(s.wins || 0),
          losses: Number(s.losses || 0),
          ties: Number(s.ties || 0),
          win_percent: s.winPercent,
          points_for: Number(s.pointsFor || 0),
          points_against: Number(s.pointsAgainst || 0),
          differential: s.differential,
          streak: s.streak,
          home: s.Home,
          road: s.Road,
          division_record: s.divisionRecord,
          conference_record: s['vs. Conf.'],
          playoff_seed: s.playoffSeed ? Number(s.playoffSeed) : null
        };
      }).sort((a, b) => Number(b.win_percent) - Number(a.win_percent)
        || (b.points_for - b.points_against) - (a.points_for - a.points_against))
    }))
  }));
  const meta = data.children?.[0]?.children?.[0]?.standings || data.children?.[0]?.standings || {};
  return {
    season: meta.season || null,
    season_display: meta.seasonDisplayName || null,
    conferences
  };
}, TTL.standings);

const getTeams = async () => cache.getOrSet('teams_all', async () => {
  const [teamsData, standings] = await Promise.all([
    fetchJson(`${ESPN_SITE}/teams`),
    getStandings().catch(() => null)
  ]);

  const divisionByTeam = {};
  (standings?.conferences || []).forEach((conf) => conf.divisions.forEach((div) => div.teams.forEach((t) => {
    divisionByTeam[t.id] = { conference: conf.abbreviation, division: div.name, record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}` };
  })));

  return (teamsData.sports?.[0]?.leagues?.[0]?.teams || []).map(({ team }) => {
    const extra = divisionByTeam[team.id] || {};
    return {
      ...normalizeTeamRef({ ...team, logo: team.logos?.[0]?.href }),
      team_id: team.abbreviation, // legacy field
      team_name: team.displayName, // legacy field
      city: team.location, // legacy field
      conference: extra.conference || null,
      division: extra.division || null,
      record: extra.record || null
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}, TTL.teams);

const findTeam = async (teamIdOrAbbr) => {
  const key = String(teamIdOrAbbr).toUpperCase();
  const teams = await getTeams();
  return teams.find((t) => t.abbreviation === key || t.id === key) || null;
};

const getTeamDetail = async (teamIdOrAbbr) => {
  const team = await findTeam(teamIdOrAbbr);
  if (!team) return null;

  return cache.getOrSet(`team_detail_${team.id}`, async () => {
    const [detail, schedule] = await Promise.all([
      fetchJson(`${ESPN_SITE}/teams/${team.id}`),
      fetchJson(`${ESPN_SITE}/teams/${team.id}/schedule`)
    ]);
    const t = detail.team || {};
    return {
      ...team,
      standing_summary: t.standingSummary || null,
      record_detail: (t.record?.items || []).map((r) => ({ type: r.type, summary: r.summary, description: r.description })),
      bye_week: schedule.byeWeek || null,
      schedule: (schedule.events || []).map(normalizeEvent)
    };
  }, TTL.live * 4);
};

const STAT_PICKS = {
  scoring: ['totalPoints', 'totalPointsPerGame', 'totalTouchdowns', 'fieldGoals'],
  passing: ['passingYards', 'passingYardsPerGame', 'completionPct', 'passingTouchdowns', 'interceptions', 'QBRating', 'sacks'],
  rushing: ['rushingYards', 'rushingYardsPerGame', 'yardsPerRushAttempt', 'rushingTouchdowns'],
  receiving: ['receivingYards', 'receptions', 'yardsPerReception', 'receivingTouchdowns'],
  miscellaneous: ['turnOverDifferential', 'thirdDownConvPct', 'fourthDownConvPct', 'redzoneScoringPct', 'totalTakeaways', 'totalGiveaways', 'totalPenaltyYards'],
  defensive: ['totalTackles', 'sacks', 'tacklesForLoss', 'passesDefended'],
  defensiveInterceptions: ['interceptions']
};

const getTeamStats = async (teamIdOrAbbr, season = null) => {
  const team = await findTeam(teamIdOrAbbr);
  if (!team) return null;

  return cache.getOrSet(`team_stats_${team.id}_${season || 'cur'}`, async () => {
    const params = season ? { season } : {};
    const data = await fetchJson(`${ESPN_SITE}/teams/${team.id}/statistics`, params);
    const categories = data.results?.stats?.categories || [];
    const byCategory = {};
    const all = {};

    categories.forEach((cat) => {
      const picks = STAT_PICKS[cat.name];
      const values = {};
      (cat.stats || []).forEach((s) => {
        all[`${cat.name}.${s.name}`] = s.value;
        if (!picks || picks.includes(s.name)) {
          values[s.name] = { label: s.displayName, abbreviation: s.abbreviation, value: s.value, display: s.displayValue };
        }
      });
      if (picks) byCategory[cat.name] = { label: cat.displayName, stats: values };
    });

    const num = (k) => (all[k] != null ? Number(all[k]) : null);
    return {
      team_id: team.abbreviation,
      team: { id: team.id, name: team.name, abbreviation: team.abbreviation, logo: team.logo },
      season: data.season?.year || season,
      games_played: num('general.gamesPlayed'),
      // Legacy summary fields
      passing_yards: num('passing.netPassingYards') ?? num('passing.passingYards'),
      rushing_yards: num('rushing.rushingYards'),
      receiving_yards: num('receiving.receivingYards'),
      total_points: num('scoring.totalPoints') ?? num('passing.totalPoints'),
      categories: byCategory
    };
  }, TTL.stats);
};

module.exports = {
  linesFrom,
  ESPN_SITE,
  fetchJson,
  findTeam,
  normalizeTeamRef,
  getScoreboard,
  getGames,
  getGameDetail,
  getGameScore,
  getStandings,
  getTeams,
  getTeamDetail,
  getTeamStats,
  normalizeEvent
};
