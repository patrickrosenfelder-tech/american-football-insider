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

// Emit useful initial HTML for crawlers that do not run React. Detailed matchup
// and story metadata is enhanced by the client after data loads, without making
// every document request depend on external feeds.
const renderMetadata = (template, pathname) => {
  const [, route = '', id] = pathname.split('/');
  let [title, description] = PAGES[route] || ['Football Insider', 'NFL information and analysis from Football Insider.'];
  if (route === 'teams' && TEAMS[id]) { title = TEAMS[id]; description = `${title}: schedule, roster, injuries, news and season statistics.`; }
  title = `${title} | AFI`;
  const canonical = new URL(pathname, process.env.SITE_URL || 'https://american-football-insider.fly.dev').href;
  const tags = [
    ['property', 'og:title', title], ['property', 'og:description', description], ['property', 'og:type', 'website'], ['property', 'og:url', canonical],
    ['name', 'twitter:card', 'summary'], ['name', 'twitter:title', title], ['name', 'twitter:description', description]
  ].map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`).join('\n');
  return template.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace('</head>', `${tags}\n<link rel="canonical" href="${escapeHtml(canonical)}" />\n</head>`);
};
module.exports = { renderMetadata };
