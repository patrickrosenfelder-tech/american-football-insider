const espn = require('../espnClient');
const cache = require('../cache');
const config = require('../config');

function flatten(group, acc = []) {
  if (group.standings?.entries) {
    acc.push({
      group: group.name,
      teams: group.standings.entries.map((e) => ({
        team: e.team?.displayName,
        abbreviation: e.team?.abbreviation,
        stats: Object.fromEntries((e.stats || []).map((s) => [s.name, s.value])),
      })),
    });
  }
  for (const child of group.children || []) flatten(child, acc);
  return acc;
}

async function getStandings() {
  return cache.wrap('standings', config.cache.standingsTtlSeconds, async () => {
    const data = await espn.getStandings();
    return flatten(data);
  });
}

module.exports = { getStandings };
