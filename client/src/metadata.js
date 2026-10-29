import { useEffect } from 'react';

// Keep in sync with PAGES in src/services/pageMetadata.js (server-rendered titles).
const ROUTES = {
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
  elo: ['Elo Ratings', 'AFI base Elo for every NFL team: results Elo plus a roster adjustment by position group.'],
  accuracy: ['Accuracy vs Vegas', 'How often the AFI model picks NFL winners compared with the Vegas closing line.'],
  weather: ['Weather', 'NFL kickoff weather forecasts and potential game impacts.'],
  playoffs: ['Playoffs', 'NFL playoff scenarios, seeds and projected odds.'],
  injuries: ['Injuries', 'NFL injury reports and practice participation.'],
  tendencies: ['Tendencies', 'NFL scheme tendencies and team comparisons.'],
  players: ['Player', 'NFL player profiles and season statistics.']
};
export const routeMetadata = (pathname) => ROUTES[pathname.split('/')[1]] || [pathname.split('/')[1].replace(/-/g, ' ') || 'Football Insider', 'NFL team information, analysis and live data from Football Insider.'];

// Matchup pages get a generated 1200x630 card; everything else uses the brand card.
// Mirrors shareImagePath() in src/services/pageMetadata.js.
export const shareImagePath = (pathname) => {
  const match = /^\/(game|preview)\/(\d{6,12})$/.exec(pathname);
  return match ? `/og/${match[1]}/${match[2]}.png` : '/og-image.png';
};

export function setPageMetadata(title, description) {
  document.title = `${title} | AFI`;
  const meta = (selector, attrs, content) => {
    let node = document.head.querySelector(selector);
    if (!node) { node = document.createElement('meta'); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v)); document.head.append(node); }
    node.setAttribute('content', content);
  };
  const url = `${window.location.origin}${window.location.pathname}`;
  meta('meta[name="description"]', { name: 'description' }, description);
  meta('meta[property="og:title"]', { property: 'og:title' }, document.title);
  meta('meta[property="og:description"]', { property: 'og:description' }, description);
  meta('meta[property="og:type"]', { property: 'og:type' }, 'website');
  meta('meta[property="og:url"]', { property: 'og:url' }, url);
  meta('meta[property="og:image"]', { property: 'og:image' }, `${window.location.origin}${shareImagePath(window.location.pathname)}`);
  meta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
  meta('meta[name="twitter:image"]', { name: 'twitter:image' }, `${window.location.origin}${shareImagePath(window.location.pathname)}`);
  meta('meta[name="twitter:title"]', { name: 'twitter:title' }, document.title);
  meta('meta[name="twitter:description"]', { name: 'twitter:description' }, description);
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
  canonical.href = url;
}

export function usePageMetadata(title, description) {
  useEffect(() => { if (title) setPageMetadata(title, description); }, [title, description]);
}
