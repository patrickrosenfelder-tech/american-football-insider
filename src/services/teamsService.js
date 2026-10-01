const espn = require('../espnClient');
const db = require('../db');
const cache = require('../cache');
const config = require('../config');
const divisions = require('../divisions');
const playersService = require('./playersService');

function normalizeTeam(teamWrapper) {
  const t = teamWrapper.team || teamWrapper;
  const alignment = divisions.lookup(t.abbreviation);
  return {
    espn_id: String(t.id),
    name: t.name ?? null,
    display_name: t.displayName ?? null,
    abbreviation: t.abbreviation ?? null,
    location: t.location ?? null,
    conference: alignment.conference,
    division: alignment.division,
    logo_url: t.logos?.[0]?.href || null,
    updated_at: new Date().toISOString(),
  };
}

async function fetchAndStoreTeams() {
  const data = await espn.getTeams();
  const rawTeams = data.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = rawTeams.map(normalizeTeam);
  for (const team of teams) db.upsertTeam(team);
  return teams;
}

async function listTeams() {
  return cache.wrap('teams:list', config.cache.teamsTtlSeconds, async () => {
    await fetchAndStoreTeams();
    return db.listTeams();
  });
}

async function getTeam(espnId) {
  return cache.wrap(`teams:${espnId}`, config.cache.teamsTtlSeconds, async () => {
    const data = await espn.getTeam(espnId);
    // ESPN answers unknown ids with 200 and either an empty object or a
    // placeholder "TBD" team, so only accept the 32 known franchises.
    if (!data.team?.id || !divisions.lookup(data.team.abbreviation).division) {
      throw Object.assign(new Error(`team ${espnId} not found`), { status: 404 });
    }
    const team = normalizeTeam(data.team);
    db.upsertTeam(team);

    const injuries = await playersService.getInjuryMapByEspnId();
    const roster = (data.team.athletes || []).map((a) => {
      const sleeperPlayer = injuries.get(String(a.id));
      return {
        espn_id: a.id,
        name: a.displayName,
        position: a.position?.abbreviation || null,
        jersey: a.jersey || null,
        injury_status: sleeperPlayer?.injury_status || null,
        injury_body_part: sleeperPlayer?.injury_body_part || null,
      };
    });

    return { ...team, record: data.team.record?.items?.[0]?.summary || null, roster };
  });
}

module.exports = { listTeams, getTeam, fetchAndStoreTeams };
