const sleeper = require('../sleeperClient');
const cache = require('../cache');
const config = require('../config');

// Sleeper uses WAS where ESPN uses WSH; everything else matches.
const SLEEPER_TO_ESPN_TEAM = { WAS: 'WSH' };

function slim(p) {
  return {
    sleeper_id: p.player_id,
    espn_id: p.espn_id ? String(p.espn_id) : null,
    name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    position: p.position || null,
    team: p.team ? (SLEEPER_TO_ESPN_TEAM[p.team] || p.team) : null,
    status: p.status || null,
    injury_status: p.injury_status || null,
    injury_body_part: p.injury_body_part || null,
    injury_notes: p.injury_notes || null,
    practice_participation: p.practice_participation || null,
  };
}

// The raw Sleeper player dump is ~15MB; keep only active players and the
// fields we serve, indexed both ways, and cache for hours.
async function getPlayerIndex() {
  return cache.wrap('sleeper:players', config.cache.playersTtlSeconds, async () => {
    const raw = await sleeper.getPlayers();
    const bySleeperId = new Map();
    const byEspnId = new Map();
    for (const p of Object.values(raw)) {
      if (!p || p.sport !== 'nfl' || !p.active) continue;
      const s = slim(p);
      bySleeperId.set(s.sleeper_id, s);
      if (s.espn_id) byEspnId.set(s.espn_id, s);
    }
    return { bySleeperId, byEspnId };
  });
}

async function getTrending({ type = 'add', limit = 25, lookbackHours = 24 } = {}) {
  const key = `sleeper:trending:${type}:${limit}:${lookbackHours}`;
  return cache.wrap(key, config.cache.trendingTtlSeconds, async () => {
    const [trending, index] = await Promise.all([
      sleeper.getTrending(type, { limit, lookbackHours }),
      getPlayerIndex(),
    ]);
    return trending.map((t) => ({
      ...(index.bySleeperId.get(t.player_id) || { sleeper_id: t.player_id }),
      count: t.count,
    }));
  });
}

async function getInjuries({ team } = {}) {
  const index = await getPlayerIndex();
  const wanted = team ? team.toUpperCase() : null;
  const normalized = wanted ? (SLEEPER_TO_ESPN_TEAM[wanted] || wanted) : null;
  const players = [];
  for (const p of index.bySleeperId.values()) {
    if (!p.injury_status || !p.team) continue;
    if (normalized && p.team !== normalized) continue;
    players.push(p);
  }
  players.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  return players;
}

// Best-effort lookup used to enrich ESPN rosters; returns an empty map if
// Sleeper is unavailable so ESPN-backed endpoints never fail because of it.
async function getInjuryMapByEspnId() {
  try {
    const index = await getPlayerIndex();
    return index.byEspnId;
  } catch (err) {
    console.warn(`Sleeper unavailable, skipping injury enrichment: ${err.message}`);
    return new Map();
  }
}

module.exports = { getTrending, getInjuries, getInjuryMapByEspnId };
