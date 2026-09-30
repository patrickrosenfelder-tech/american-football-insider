const espn = require('../espnClient');
const db = require('../db');
const cache = require('../cache');
const config = require('../config');

function normalizeTeam(teamWrapper) {
  const t = teamWrapper.team || teamWrapper;
  return {
    espn_id: String(t.id),
    name: t.name,
    display_name: t.displayName,
    abbreviation: t.abbreviation,
    location: t.location,
    conference: t.groups?.parent?.name || null,
    division: t.groups?.name || null,
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
    const team = normalizeTeam(data.team);
    db.upsertTeam(team);

    const roster = (data.team.athletes || []).map((a) => ({
      espn_id: a.id,
      name: a.displayName,
      position: a.position?.abbreviation || null,
      jersey: a.jersey || null,
    }));

    return { ...team, record: data.team.record?.items?.[0]?.summary || null, roster };
  });
}

module.exports = { listTeams, getTeam, fetchAndStoreTeams };
