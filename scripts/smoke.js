// Live end-to-end check against a running server (real ESPN + Sleeper data).
// Usage: npm start  (in one terminal), then: npm run smoke [-- http://host:port]
const base = process.argv[2] || process.env.API_URL || 'http://localhost:3000';

async function get(path) {
  const started = Date.now();
  const res = await fetch(base + path);
  const body = await res.json();
  return { status: res.status, body, ms: Date.now() - started };
}

const checks = [
  ['/health', (b) => b.status === 'ok'],
  ['/api/teams', (b) => b.count === 32 && b.teams.every((t) => t.division)],
  ['/api/teams/22', (b) => b.display_name === 'Arizona Cardinals' && b.roster.length > 40],
  ['/api/games/scoreboard', (b) => b.count > 0],
  ['/api/games/db', (b) => b.count > 0],
  ['/api/standings', (b) => b.standings.length > 0],
  ['/api/players/trending?limit=5', (b) => b.count === 5 && b.players[0].name],
  ['/api/players/injuries?team=KC', (b) => Array.isArray(b.players)],
];

(async () => {
  let failed = 0;
  const run = async (path, ok) => {
    try {
      const { status, body, ms } = await get(path);
      const pass = status === 200 && ok(body);
      if (!pass) failed += 1;
      console.log(`${pass ? 'PASS' : 'FAIL'} ${status} ${String(ms).padStart(5)}ms ${path}`);
      return body;
    } catch (err) {
      failed += 1;
      console.log(`FAIL ${path}: ${err.message}`);
      return null;
    }
  };

  for (const [path, ok] of checks) await run(path, ok);

  // Find a completed game from last week and check its box score.
  const sb = await get('/api/games/scoreboard');
  const week = sb.body.games?.[0]?.week;
  const prev = week > 1 ? (await get(`/api/games/scoreboard?week=${week - 1}`)).body : sb.body;
  const done = prev.games?.find((g) => g.status_state === 'post');
  if (done) {
    await run(`/api/games/${done.espn_id}`, (b) => b.competitors.length === 2 && b.playerStats.length > 0);
    await run(`/api/stats/game/${done.espn_id}`, (b) => b.count > 0);
  }

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
