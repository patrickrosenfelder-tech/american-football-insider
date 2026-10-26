// robots.txt, sitemap, real 404s, security headers, cache headers, local logos,
// server-rendered summaries and share images. Upstream ESPN calls are mocked.
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/db/database', () => new Proxy({}, { get: (target, key) => (key === '__esModule' ? false : (target[key] ||= jest.fn(async () => null))) }));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'afi-dist-'));
fs.mkdirSync(path.join(dist, 'assets'));
fs.mkdirSync(path.join(dist, 'logos'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><meta name="description" content="Generic" /><title>Generic</title><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>');
fs.writeFileSync(path.join(dist, 'assets/index-abc123.js'), 'console.log(1)');
fs.writeFileSync(path.join(dist, 'sw.js'), '// sw');
for (const file of ['kc-96.webp', 'kc-192.webp', 'kc-192.png', 'buf-192.png']) fs.copyFileSync(path.join(__dirname, '../client/public/logos', file), path.join(dist, 'logos', file));
process.env.CLIENT_DIST = dist;

const sports = require('../src/services/sportsDataService');
const playoffService = require('../src/services/playoffService');
const app = require('../src/app');

const GAME = {
  game_id: '401873010', date: '2026-10-26T17:00:00Z', status: { state: 'post', detail: 'Final' }, broadcast: 'CBS',
  venue: { name: 'Arrowhead Stadium', city: 'Kansas City' }, odds: 'KC -3',
  away: { abbreviation: 'BUF', name: 'Buffalo Bills', short_name: 'Bills', color: '#00338d', score: 24, record: '5-2' },
  home: { abbreviation: 'KC', name: 'Kansas City Chiefs', short_name: 'Chiefs', color: '#e31837', score: 27, record: '6-1' }
};

let server;
let base;
beforeAll(async () => {
  jest.spyOn(sports, 'getGameDetail').mockImplementation(async (id) => (id === GAME.game_id ? GAME : null));
  jest.spyOn(sports, 'getScoreboard').mockResolvedValue({ season: 2026, season_type: 2, week: 8, games: [{ ...GAME, status: { state: 'pre' } }] });
  jest.spyOn(sports, 'getStandings').mockResolvedValue({ season_display: '2026', conferences: [{ name: 'American Football Conference', divisions: [{ name: 'AFC West', teams: [{ name: 'Kansas City Chiefs', wins: 6, losses: 1, ties: 0 }] }] }] });
  jest.spyOn(playoffService, 'loadSeason').mockResolvedValue({ games: [{ id: '401873010', date: '2026-10-26T17:00:00Z', state: 'post' }, { id: '401873011', date: '2026-11-02T18:00:00Z', state: 'pre' }] });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => { server?.close(); jest.restoreAllMocks(); fs.rmSync(dist, { recursive: true, force: true }); });

const get = (p) => fetch(`${base}${p}`, { redirect: 'manual' });

test('robots.txt is plain text and points to the sitemap', async () => {
  const res = await get('/robots.txt');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
  const body = await res.text();
  expect(body).toMatch(/^User-agent: \*/);
  expect(body).toContain('Disallow: /api/');
  expect(body).toContain('Sitemap: https://american-football-insider.fly.dev/sitemap.xml');
});

test('sitemap.xml is XML with static routes, team pages and current-season game pages', async () => {
  const res = await get('/sitemap.xml');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^application\/xml/);
  const body = await res.text();
  expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
  expect(body).toContain('<loc>https://american-football-insider.fly.dev/standings</loc>');
  expect(body).toContain('<loc>https://american-football-insider.fly.dev/teams/KC</loc>');
  expect(body).toContain('<loc>https://american-football-insider.fly.dev/game/401873010</loc><lastmod>2026-10-26</lastmod>');
  expect(body).toContain('/preview/401873011</loc>');
  expect(body).not.toContain('/preview/401873010<');
  expect(body).not.toContain('<html');
});

test.each(['/nonexistent-xyz', '/teams/XYZ', '/game/abc', '/game/123456789', '/preview/123456789', '/assets/missing.js'])('%s returns a real 404 with a not-found title', async (p) => {
  const res = await get(p);
  expect(res.status).toBe(404);
  const html = await res.text();
  expect(html).toContain('<title>Page not found | AFI</title>');
  expect(html).toContain('<meta name="robots" content="noindex" />');
  expect(html).not.toContain('rel="canonical"');
});

test('known routes return 200 with canonical, large share card and a server-rendered summary', async () => {
  const home = await (await get('/')).text();
  expect(home).toContain('<h1>2026 Week 8</h1>');
  expect(home).toContain('Buffalo Bills at Kansas City Chiefs · Mon, Oct 26, 1:00 PM ET · CBS');
  expect(home).toContain('name="twitter:card" content="summary_large_image"');
  expect(home).toContain('property="og:image" content="https://american-football-insider.fly.dev/og-image.png"');

  const game = await get('/game/401873010');
  expect(game.status).toBe(200);
  const html = await game.text();
  expect(html).toContain('<title>Buffalo Bills at Kansas City Chiefs | AFI</title>');
  expect(html).toContain('<h1>Buffalo Bills at Kansas City Chiefs</h1>');
  expect(html).toContain('Buffalo Bills 24, Kansas City Chiefs 27 · Final');
  expect(html).toContain('rel="canonical" href="https://american-football-insider.fly.dev/game/401873010"');
  expect(html).toContain('property="og:image" content="https://american-football-insider.fly.dev/og/game/401873010.png"');

  const preview = await (await get('/preview/401873010')).text();
  expect(preview).toContain('<h1>Buffalo Bills at Kansas City Chiefs matchup preview</h1>');
  expect(await (await get('/standings')).text()).toContain('<h1>2026 Standings</h1>');
  expect((await get('/picks')).status).toBe(200);
  expect((await get('/teams/KC')).status).toBe(200);
  expect((await get('/news/inj-KC-2026-10-26')).status).toBe(200);
});

test('every response carries the security headers', async () => {
  for (const p of ['/', '/api/health', '/robots.txt', '/nonexistent-xyz']) {
    const res = await get(p);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://a.espncdn.com');
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=31536000/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
    expect(res.headers.get('x-powered-by')).toBeNull();
  }
});

test('hashed bundles are immutable, logos long-cached, HTML and the service worker revalidate', async () => {
  expect((await get('/assets/index-abc123.js')).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect((await get('/sw.js')).headers.get('cache-control')).toBe('no-cache');
  expect((await get('/')).headers.get('cache-control')).toBe('no-cache');
  const logo = await get('/logos/kc-96.webp');
  expect(logo.status).toBe(200);
  expect(logo.headers.get('content-type')).toBe('image/webp');
  expect(logo.headers.get('cache-control')).toBe('public, max-age=31536000');
});

test('local logo copies are small and exist for all 32 teams in both sizes', () => {
  const dir = path.join(__dirname, '../client/public/logos');
  const { TEAM_CODES } = require('../src/services/siteRoutes');
  for (const team of TEAM_CODES.map((t) => t.toLowerCase())) {
    for (const file of [`${team}-96.webp`, `${team}-192.webp`, `${team}-96.png`, `${team}-192.png`]) {
      expect(fs.statSync(path.join(dir, file)).size).toBeLessThan(40 * 1024);
    }
  }
});

test('matchup share image is a cached 1200x630 PNG; unknown games 404', async () => {
  const res = await get('/og/game/401873010.png');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  const png = Buffer.from(await res.arrayBuffer());
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  expect((await get('/og/preview/123456789.png')).status).toBe(404);
});

test('static brand card is 1200x630 and under 150 KB', () => {
  const png = fs.readFileSync(path.join(__dirname, '../client/public/og-image.png'));
  expect(png.length).toBeLessThan(150 * 1024);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});
