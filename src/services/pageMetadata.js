const PAGES = {
  '': ['Games', 'NFL scores, upcoming games, kickoff times and matchup previews.'],
  standings: ['Standings', 'NFL division standings, records and conference playoff seeds.'],
  teams: ['Teams', 'NFL team schedules, rosters, injuries and season statistics.'],
  picks: ['Picks', 'AFI model spread, total and moneyline picks with a transparent tracked record.'],
  news: ['News', 'NFL news summaries and data stories with links to their sources.'],
  preview: ['Matchup Preview', 'NFL matchup form, injuries, trends, model picks and kickoff weather.'],
  previews: ['Matchup Previews', 'NFL matchup previews with form, injuries, trends and weather.'],
  game: ['Game Center', 'NFL game scores, team statistics, leaders and scoring plays.'],
  status: ['Data Status', 'Refresh health, last successful updates and data-source errors.'],
  trades: ['Trades', 'NFL trades, transactions and sourced trade rumors.'],
  'free-agents': ['Free Agents', 'NFL free agents and recent player signings.'],
  model: ['AFI Model', 'AFI model methodology, prediction quality and backtests.'],
  'power-rankings': ['Power Rankings', 'NFL team power rankings and performance signals.'],
  weather: ['Weather', 'NFL kickoff weather forecasts and potential game impacts.'],
  playoffs: ['Playoffs', 'NFL playoff scenarios, seeds and projected odds.'],
  injuries: ['Injuries', 'NFL injury reports and practice participation.'],
  tendencies: ['Tendencies', 'NFL scheme tendencies and team comparisons.'],
  players: ['Player', 'NFL player profiles and season statistics.']
};
const TEAMS = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers', SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WSH: 'Washington Commanders'
};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Matchup pages get a generated 1200x630 card (src/services/shareImage.js); every other
// page uses the static brand card. Mirrors shareImagePath() in client/src/metadata.js.
const shareImagePath = (pathname) => {
  const match = /^\/(game|preview)\/(\d{6,12})$/.exec(pathname);
  return match ? `/og/${match[1]}/${match[2]}.png` : '/og-image.png';
};

const NAV = [['/', 'Games'], ['/standings', 'Standings'], ['/picks', 'Picks'], ['/teams', 'Teams'], ['/news', 'News']];
// Static shell shown until React boots (React replaces everything inside #root).
const shellHtml = (bodyHtml) => `<header class="topbar"><div class="wrap topbar-inner"><a href="/" class="brand"><img src="/favicon.svg" alt="" width="28" height="28" /><span>Football <b>Insider</b></span></a><nav aria-label="Primary navigation">${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav></div></header>
<main class="wrap" id="main-content"><div class="ssr-summary">
${bodyHtml}
</div></main>`;

// Emit useful initial HTML for crawlers that do not run React. `page` may carry a
// server-side summary (src/services/prerender.js): { title, description, html, notFound }.
const renderMetadata = (template, pathname, page = {}) => {
  const [, route = '', id] = pathname.split('/');
  let [title, description] = PAGES[route] || ['Football Insider', 'NFL information and analysis from Football Insider.'];
  if (route === 'teams' && TEAMS[id]) { title = TEAMS[id]; description = `${title}: schedule, roster, injuries, news and season statistics.`; }
  if (page.title) title = page.title;
  if (page.description) description = page.description;
  if (page.notFound) { title = 'Page not found'; description = 'The page you requested does not exist on Football Insider.'; }
  const heading = title;
  title = `${title} | AFI`;
  const site = process.env.SITE_URL || 'https://american-football-insider.fly.dev';
  const canonical = new URL(pathname, site).href;
  const image = new URL(shareImagePath(pathname), site).href;
  const tags = [
    ['property', 'og:title', title], ['property', 'og:description', description], ['property', 'og:type', 'website'], ['property', 'og:url', canonical],
    ['property', 'og:image', image], ['property', 'og:image:width', '1200'], ['property', 'og:image:height', '630'], ['property', 'og:site_name', 'Football Insider'],
    ['name', 'twitter:card', 'summary_large_image'], ['name', 'twitter:title', title], ['name', 'twitter:description', description], ['name', 'twitter:image', image]
  ].map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`).join('\n');
  // A 404 must not claim a canonical URL or be indexed.
  const head = page.notFound ? `${tags}\n<meta name="robots" content="noindex" />` : `${tags}\n<link rel="canonical" href="${escapeHtml(canonical)}" />`;
  const body = page.notFound
    ? shellHtml('<h1>Page not found</h1>\n<p>That page doesn’t exist. <a href="/">Go to this week’s games</a></p>')
    : shellHtml(page.html || `<h1>${escapeHtml(heading)}</h1>\n<p>${escapeHtml(description)}</p>`);
  return template.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace('</head>', `${head}\n</head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
};
module.exports = { renderMetadata, shareImagePath };
