const cache = require('../cache/cacheManager');
const { ESPN_SITE, fetchJson, findTeam } = require('./sportsDataService');
const ratingService = require('./ratingService');

const ESPN_ATHLETE = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes';

// Rosters and depth charts change a few times a week; 6h keeps them "daily" fresh while
// avoiding hammering ESPN. The refresh job busts and re-warms these once a day.
const TTL = { roster: 6 * 3600, depth: 6 * 3600, player: 6 * 3600 };

const headshotUrl = (id) => `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;

const currentSeason = () => {
  const now = new Date();
  // NFL seasons start in September; Jan-Jul still belong to the previous season.
  return now.getUTCMonth() < 7 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
};

const ratingFor = (ratings, id) => {
  const r = ratings?.ratings?.[id];
  return r ? r.rating : null;
};

const normalizeAthlete = (a = {}) => ({
  id: a.id,
  name: a.displayName || a.fullName,
  short_name: a.shortName || a.displayName,
  jersey: a.jersey || null,
  position: a.position?.abbreviation || null,
  position_name: a.position?.displayName || null,
  headshot: a.headshot?.href || (a.id ? headshotUrl(a.id) : null),
  age: a.age ?? null,
  height: a.displayHeight || null,
  weight: a.displayWeight || null,
  experience: a.experience?.years ?? null,
  college: a.college?.name || null,
  status: a.status?.name || null
});

const ROSTER_GROUPS = {
  offense: 'Offense',
  defense: 'Defense',
  specialTeam: 'Special Teams',
  injuredReserveOrOut: 'Injured Reserve / Out',
  suspended: 'Suspended',
  practiceSquad: 'Practice Squad'
};

// Position order inside each roster group (for the "grouped by position" roster page).
const POSITION_ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'T', 'G', 'OG', 'C', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'CB', 'S', 'FS', 'SS', 'PK', 'K', 'P', 'LS'];
const posRank = (p) => {
  const i = POSITION_ORDER.indexOf(p);
  return i === -1 ? POSITION_ORDER.length : i;
};

const fetchRoster = async (team) => cache.getOrSet(`roster_${team.id}`, async () => {
  const data = await fetchJson(`${ESPN_SITE}/teams/${team.id}/roster`);
  const season = data.season?.year || currentSeason();
  const groups = (data.athletes || []).map((g) => ({
    key: g.position,
    label: ROSTER_GROUPS[g.position] || g.position,
    athletes: (g.items || []).map((a) => ({ ...normalizeAthlete(a), roster_injuries: a.injuries || [] }))
  }));
  const coach = data.coach?.[0] ? `${data.coach[0].firstName} ${data.coach[0].lastName}` : null;
  return { season, coach, groups, fetched_at: new Date().toISOString() };
}, TTL.roster);

const getRoster = async (teamIdOrAbbr, { decorate = (a) => a } = {}) => {
  const team = await findTeam(teamIdOrAbbr);
  if (!team) return null;
  const roster = await fetchRoster(team);
  const ratings = await ratingService.getRatings(roster.season);
  const groups = roster.groups.map((g) => {
    const byPosition = {};
    g.athletes.forEach((a) => {
      const athlete = decorate({ ...a, rating: ratingFor(ratings, a.id) });
      delete athlete.roster_injuries;
      (byPosition[a.position || 'Other'] ||= []).push(athlete);
    });
    return {
      key: g.key,
      label: g.label,
      count: g.athletes.length,
      positions: Object.keys(byPosition)
        .sort((x, y) => posRank(x) - posRank(y))
        .map((pos) => ({ position: pos, athletes: byPosition[pos].sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0)) }))
    };
  });
  return {
    team,
    season: roster.season,
    coach: roster.coach,
    groups,
    ratings_through_week: ratings?.data_through_week ?? null,
    last_updated: roster.fetched_at
  };
};

// --- Depth chart ------------------------------------------------------------

// Madden-style labels for ESPN depth chart slot keys.
const SLOT_LABELS = {
  offense: { wr1: 'WR', wr2: 'WR', wr3: 'SLOT', lt: 'LT', lg: 'LG', c: 'C', rg: 'RG', rt: 'RT', qb: 'QB', te: 'TE', rb: 'HB', fb: 'FB' },
  '4-3': { lde: 'LE', ldt: 'DT', rdt: 'DT', rde: 'RE', wlb: 'WILL', mlb: 'MIKE', slb: 'SAM', lcb: 'CB', rcb: 'CB', ss: 'SS', fs: 'FS', nb: 'NICKEL' },
  '3-4': { lde: 'DE', nt: 'NT', rde: 'DE', wlb: 'EDGE', slb: 'EDGE', lilb: 'MIKE', rilb: 'WILL', lcb: 'CB', rcb: 'CB', ss: 'SS', fs: 'FS', nb: 'NICKEL' },
  special: { pk: 'K', p: 'P', h: 'H', pr: 'PR', kr: 'KR', ls: 'LS' }
};

const unitOf = (formation) => {
  const name = (formation.name || '').toLowerCase();
  if (name.includes('special')) return 'special';
  if (name.includes('3-4')) return 'defense';
  if (name.includes('4-3') || name.endsWith(' d')) return 'defense';
  return 'offense';
};

const getDepthChart = async (teamIdOrAbbr, { decorate = (a) => a } = {}) => {
  const team = await findTeam(teamIdOrAbbr);
  if (!team) return null;

  const [raw, roster] = await Promise.all([
    cache.getOrSet(`depth_${team.id}`, async () => ({
      data: await fetchJson(`${ESPN_SITE}/teams/${team.id}/depthcharts`),
      fetched_at: new Date().toISOString()
    }), TTL.depth),
    fetchRoster(team)
  ]);
  const ratings = await ratingService.getRatings(roster.season);
  const rosterById = {};
  roster.groups.forEach((g) => g.athletes.forEach((a) => { rosterById[a.id] = a; }));

  const units = {};
  (raw.data.depthchart || []).forEach((formation) => {
    const unit = unitOf(formation);
    const scheme = unit === 'defense' ? (formation.name.includes('3-4') ? '3-4' : '4-3') : null;
    const labels = SLOT_LABELS[unit === 'defense' ? scheme : unit];
    const slots = Object.entries(formation.positions || {}).map(([key, slot]) => ({
      key,
      label: labels[key] || slot.position?.abbreviation || key.toUpperCase(),
      espn_position: slot.position?.abbreviation || null,
      espn_position_name: slot.position?.displayName || null,
      players: (slot.athletes || []).map((a, i) => {
        const r = rosterById[a.id] || {};
        const athlete = {
          id: a.id,
          depth: a.rank || i + 1,
          name: a.displayName || r.name,
          short_name: a.shortName || r.short_name,
          jersey: r.jersey || null,
          position: r.position || null,
          headshot: r.headshot || headshotUrl(a.id),
          rating: ratingFor(ratings, a.id)
        };
        return decorate(athlete);
      })
    }));
    units[unit] = { formation: formation.name, scheme, slots };
  });

  return {
    team,
    season: roster.season,
    base_defense: units.defense?.scheme || null,
    offense: units.offense || null,
    defense: units.defense || null,
    special_teams: units.special || null,
    ratings_through_week: ratings?.data_through_week ?? null,
    rating_note: 'AFI rating (0-99) is our own stat-based rating, not an EA Madden rating.',
    last_updated: raw.fetched_at
  };
};

// --- Player page ------------------------------------------------------------

const getPlayer = async (athleteId, { decorate = (a) => a } = {}) => {
  const bio = await cache.getOrSet(`player_${athleteId}`, async () => {
    try {
      const data = await fetchJson(`${ESPN_ATHLETE}/${athleteId}`);
      return { athlete: data.athlete, fetched_at: new Date().toISOString() };
    } catch (error) {
      if (error.response && [400, 404].includes(error.response.status)) return { athlete: null };
      throw error;
    }
  }, TTL.player);
  const a = bio.athlete;
  if (!a) return null;

  const season = currentSeason();
  const ratings = await ratingService.getRatings(season);
  const rating = ratings?.ratings?.[a.id] || null;

  return decorate({
    id: a.id,
    name: a.displayName,
    first_name: a.firstName,
    last_name: a.lastName,
    jersey: a.jersey || null,
    position: a.position?.abbreviation || null,
    position_name: a.position?.displayName || null,
    headshot: a.headshot?.href || headshotUrl(a.id),
    team: a.team ? {
      id: a.team.id,
      abbreviation: a.team.abbreviation,
      name: a.team.displayName,
      color: a.team.color ? `#${a.team.color}` : null,
      logo: a.team.logos?.[0]?.href || null
    } : null,
    age: a.age ?? null,
    height: a.displayHeight || null,
    weight: a.displayWeight || null,
    birthplace: a.displayBirthPlace || null,
    college: a.college?.name || null,
    experience: a.displayExperience || null,
    draft: a.displayDraft || null,
    status: a.status?.name || null,
    season,
    // ESPN's season summary (with league rank) plus nflverse's full season line.
    stats_summary: (a.statsSummary?.statistics || []).map((s) => ({ label: s.displayName, value: s.displayValue, rank: s.rankDisplayValue || null })),
    season_stats: ratings?.stat_lines?.[a.id] || null,
    afi: rating,
    ratings_through_week: ratings?.data_through_week ?? null,
    espn_url: a.links?.find((l) => (l.rel || []).includes('playercard'))?.href || null,
    last_updated: bio.fetched_at
  });
};

const bustTeam = (teamId) => {
  cache.del(`roster_${teamId}`);
  cache.del(`depth_${teamId}`);
};

module.exports = {
  currentSeason,
  getRoster,
  getDepthChart,
  getPlayer,
  bustTeam,
  headshotUrl
};
