// Server-side knowledge of the client routes (client/src/App.jsx), so unknown
// paths get a real 404 instead of a 200 SPA shell, plus robots.txt and the sitemap.
const SITE_URL = () => (process.env.SITE_URL || 'https://american-football-insider.fly.dev').replace(/\/$/, '');

const TEAM_CODES = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WSH'];
const STATIC_ROUTES = ['/', '/standings', '/picks', '/teams', '/news', '/previews', '/injuries', '/weather', '/playoffs', '/tendencies',
  '/power-rankings', '/elo', '/accuracy', '/trades', '/free-agents', '/model', '/social', '/status'];
// Sitemap omits redirects (/previews, /social) and the operational status page.
const SITEMAP_STATIC = ['/', '/standings', '/picks', '/teams', '/news', '/injuries', '/weather', '/playoffs', '/tendencies', '/power-rankings', '/elo', '/accuracy', '/trades', '/free-agents', '/model'];

const GAME_ID = /^\d{6,12}$/;
const NUMERIC_ID = /^\d{1,12}$/;
// ESPN team pages also accept numeric team ids (1-34).
const isTeam = (id) => TEAM_CODES.includes(String(id).toUpperCase()) || /^\d{1,2}$/.test(id);

const PATTERNS = [
  [/^\/teams\/([^/]+)$/, ([id]) => isTeam(id)],
  [/^\/game\/([^/]+)$/, ([id]) => GAME_ID.test(id), 'game'],
  [/^\/preview\/([^/]+)$/, ([id]) => GAME_ID.test(id), 'preview'],
  [/^\/weather\/game\/([^/]+)$/, ([id]) => GAME_ID.test(id)],
  [/^\/players\/([^/]+)$/, ([id]) => NUMERIC_ID.test(id)],
  [/^\/news\/([^/]+)$/, ([id]) => /^[\w-]{1,128}$/.test(id)]
];

// { known, kind?, id? }: `known` is false for paths the client router would render as "Page not found".
const classifyPath = (pathname) => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (STATIC_ROUTES.includes(path)) return { known: true };
  for (const [re, valid, kind] of PATTERNS) {
    const m = re.exec(path);
    if (m) {
      const params = m.slice(1).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
      return valid(params) ? { known: true, kind, id: params[0] } : { known: false };
    }
  }
  return { known: false };
};

const robotsTxt = () => [
  'User-agent: *',
  'Allow: /',
  'Disallow: /api/',
  'Disallow: /admin/',
  'Disallow: /status',
  '',
  `Sitemap: ${SITE_URL()}/sitemap.xml`,
  ''
].join('\n');

const xmlEscape = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// games: [{ id, date, state }] from the current season schedule.
const sitemapXml = (games = []) => {
  const base = SITE_URL();
  const urls = [
    ...SITEMAP_STATIC.map((p) => ({ loc: `${base}${p}`, changefreq: p === '/' ? 'hourly' : 'daily' })),
    ...TEAM_CODES.map((t) => ({ loc: `${base}/teams/${t}`, changefreq: 'daily' })),
    ...games.flatMap((g) => {
      const lastmod = g.date ? String(g.date).slice(0, 10) : null;
      const pages = [{ loc: `${base}/game/${g.id}`, lastmod, changefreq: g.state === 'post' ? 'monthly' : 'hourly' }];
      if (g.state === 'pre') pages.push({ loc: `${base}/preview/${g.id}`, lastmod, changefreq: 'daily' });
      return pages;
    })
  ];
  const body = urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
};

module.exports = { classifyPath, robotsTxt, sitemapXml, TEAM_CODES, SITE_URL };
