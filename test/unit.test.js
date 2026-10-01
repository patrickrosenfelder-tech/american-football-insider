const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'afi-')), 'test.db');

const app = require('../src/app');
const cache = require('../src/cache');
const divisions = require('../src/divisions');
const { normalizeEvent, extractPlayerStats } = require('../src/services/gamesService');

test('every team maps to one of 8 divisions, 4 teams each', () => {
  const all = Object.values(divisions.DIVISIONS).flat();
  assert.strictEqual(all.length, 32);
  assert.strictEqual(new Set(all).size, 32);
  assert.deepStrictEqual(divisions.lookup('WSH'), { conference: 'NFC', division: 'NFC East' });
  assert.deepStrictEqual(divisions.lookup('XXX'), { conference: null, division: null });
});

test('normalizeEvent flattens an ESPN scoreboard event', () => {
  const game = normalizeEvent({
    id: '401',
    date: '2026-10-02T00:15Z',
    season: { year: 2026, type: 2 },
    week: { number: 4 },
    status: { period: 2, displayClock: '3:10', type: { state: 'in', detail: '3:10 - 2nd' } },
    competitions: [{
      venue: { fullName: 'Huntington Bank Field' },
      competitors: [
        { homeAway: 'home', score: '7', team: { id: '5', displayName: 'Cleveland Browns' } },
        { homeAway: 'away', score: '10', team: { id: '23', displayName: 'Pittsburgh Steelers' } },
      ],
    }],
  });
  assert.strictEqual(game.espn_id, '401');
  assert.strictEqual(game.home_score, 7);
  assert.strictEqual(game.away_score, 10);
  assert.strictEqual(game.status_state, 'in');
  assert.strictEqual(game.week, 4);
});

test('extractPlayerStats emits one row per player per category', () => {
  const rows = extractPlayerStats('401', {
    players: [{
      team: { id: '5', displayName: 'Cleveland Browns' },
      statistics: [{
        name: 'passing',
        keys: ['completions/passingAttempts', 'passingYards'],
        athletes: [{ athlete: { displayName: 'QB One' }, stats: ['20/30', '250'] }],
      }],
    }],
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].stat_category, 'passing');
  assert.deepStrictEqual(JSON.parse(rows[0].stat_values), ['20/30', '250']);
});

test('cache.wrap de-duplicates concurrent cold fetches', async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return 42; };
  const results = await Promise.all([1, 2, 3].map(() => cache.wrap('unit:dedupe', 60, fetchFn)));
  assert.deepStrictEqual(results, [42, 42, 42]);
  assert.strictEqual(calls, 1);
});

test('HTTP: health, 404 and invalid-id validation need no upstream', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/health`);
  assert.strictEqual(health.status, 200);
  assert.strictEqual((await health.json()).status, 'ok');

  assert.strictEqual((await fetch(`${base}/nope`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/teams/abc`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/games/abc`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/stats/game/abc`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/players/trending?type=bogus`)).status, 400);
});
