const cache = require('../cache/cacheManager');
const db = require('../db/database');
const { ESPN_SITE, fetchJson, getTeams } = require('./sportsDataService');
const { assetUrl, streamCsv, loadIdMap } = require('./nflverseService');

// Injury status comes from ESPN's league-wide injuries feed (refreshed hourly via cache TTL).
// Practice participation comes from the NFL's official injury report via nflverse
// (injuries_<season>.csv), which only exists for game weeks that already had a report.
const TTL_INJURIES = 3600;

const STATUS_ORDER = ['Out', 'Injured Reserve', 'Physically Unable to Perform', 'Doubtful', 'Questionable', 'Suspension', 'Day-To-Day'];
const severity = (status) => {
  const i = STATUS_ORDER.findIndex((s) => status && status.toLowerCase().startsWith(s.toLowerCase()));
  return i === -1 ? STATUS_ORDER.length : i;
};

const athleteIdFrom = (athlete = {}) => {
  const href = athlete.links?.[0]?.href || athlete.headshot?.href || '';
  const m = href.match(/\/id\/(\d+)/) || href.match(/full\/(\d+)\.png/);
  return m ? m[1] : null;
};

const injuryText = (details) => {
  if (!details) return null;
  const parts = [details.side && details.side !== 'Not Specified' ? details.side : null, details.type,
    details.detail && details.detail !== 'Not Specified' ? `(${details.detail})` : null].filter(Boolean);
  return parts.join(' ') || null;
};

// --- Practice participation (nflverse) -------------------------------------

let practiceMemo = null;

const refreshPracticeReport = async (season) => {
  const idMap = await loadIdMap();
  const latest = {}; // espn_id -> latest week's row
  let maxWeek = 0;
  await streamCsv(assetUrl('injuries', `injuries_${season}.csv`), (r) => {
    if (r.game_type !== 'REG' && r.game_type !== 'POST') return;
    const ids = idMap.gsis[r.gsis_id];
    if (!ids) return;
    const week = Number(r.week) || 0;
    maxWeek = Math.max(maxWeek, week);
    if (latest[ids.espn_id] && latest[ids.espn_id].week > week) return;
    latest[ids.espn_id] = {
      week,
      practice_status: r.practice_status || null,
      report_status: r.report_status || null,
      injury: [r.report_primary_injury || r.practice_primary_injury, r.report_secondary_injury || r.practice_secondary_injury].filter(Boolean).join(', ') || null
    };
  }, { columns: ['game_type', 'week', 'gsis_id', 'report_primary_injury', 'report_secondary_injury', 'report_status', 'practice_primary_injury', 'practice_secondary_injury', 'practice_status'] });
  const result = { season, latest_week: maxWeek || null, players: latest };
  await db.saveDataset(`practice_${season}`, result, { latest_week: maxWeek });
  practiceMemo = result;
  return result;
};

const getPracticeReport = async (season) => {
  if (practiceMemo && practiceMemo.season === season) return practiceMemo;
  const row = await db.loadDataset(`practice_${season}`);
  practiceMemo = row ? row.data : null;
  return practiceMemo;
};

// --- ESPN injury feed ------------------------------------------------------

const fetchLeagueInjuries = () => cache.getOrSet('injuries_league', async () => {
  const [data, teams] = await Promise.all([fetchJson(`${ESPN_SITE}/injuries`), getTeams()]);
  const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const season = data.season?.year || null;
  const list = (data.injuries || []).map((t) => {
    const team = teamsById[t.id] || { id: t.id, name: t.displayName };
    const injuries = (t.injuries || [])
      .filter((i) => i.status && i.status !== 'Active')
      .map((i) => ({
        athlete_id: athleteIdFrom(i.athlete),
        name: i.athlete?.displayName || null,
        position: i.athlete?.position?.abbreviation || null,
        headshot: i.athlete?.headshot?.href || null,
        status: i.status,
        injury: injuryText(i.details),
        return_date: i.details?.returnDate || null,
        comment: i.longComment && i.longComment.toLowerCase() !== i.status.toLowerCase() ? i.longComment : null,
        updated: i.date || null
      }))
      .sort((a, b) => severity(a.status) - severity(b.status) || (b.updated || '').localeCompare(a.updated || ''));
    return {
      team: { id: team.id, abbreviation: team.abbreviation, name: team.name, logo: team.logo, color: team.color },
      injuries
    };
  }).sort((a, b) => (a.team.name || '').localeCompare(b.team.name || ''));
  return { season, teams: list, fetched_at: new Date().toISOString() };
}, TTL_INJURIES);

const withPractice = (injury, practice) => {
  const p = practice?.players?.[injury.athlete_id];
  return {
    ...injury,
    practice: p?.practice_status || null,
    official_report_status: p?.report_status || null,
    practice_report_week: p ? p.week : null
  };
};

const getLeagueInjuries = async () => {
  const feed = await fetchLeagueInjuries();
  const practice = await getPracticeReport(feed.season);
  const teams = feed.teams.map((t) => ({ ...t, injuries: t.injuries.map((i) => withPractice(i, practice)) }));
  const counts = {};
  teams.forEach((t) => t.injuries.forEach((i) => { counts[i.status] = (counts[i.status] || 0) + 1; }));
  return {
    season: feed.season,
    counts,
    teams,
    practice_report_week: practice?.latest_week ?? null,
    last_updated: feed.fetched_at
  };
};

const getTeamInjuries = async (team) => {
  const league = await getLeagueInjuries();
  const entry = league.teams.find((t) => t.team.id === team.id) || { team, injuries: [] };
  return { ...entry, season: league.season, practice_report_week: league.practice_report_week, last_updated: league.last_updated };
};

// athleteId -> { status, injury, practice } for badges on depth chart / roster / player cards.
const getInjuryMap = async () => {
  const league = await getLeagueInjuries();
  const map = {};
  league.teams.forEach((t) => t.injuries.forEach((i) => {
    if (i.athlete_id) map[i.athlete_id] = { status: i.status, injury: i.injury, practice: i.practice, practice_week: i.practice_report_week, return_date: i.return_date, updated: i.updated };
  }));
  return map;
};

// Returns a decorate(athlete) function that attaches `injury` (or null).
const injuryDecorator = async () => {
  let map = {};
  try {
    map = await getInjuryMap();
  } catch (error) {
    console.error('Injury feed unavailable:', error.message);
  }
  return (a) => ({ ...a, injury: map[a.id] || null });
};

module.exports = {
  getLeagueInjuries,
  getTeamInjuries,
  getInjuryMap,
  injuryDecorator,
  refreshPracticeReport,
  getPracticeReport,
  severity
};
