import { useEffect } from 'react';

const ROUTES = {
  '': ['Games', 'NFL scores, upcoming games, kickoff times and matchup previews.'],
  standings: ['Standings', 'NFL division standings, records and conference playoff seeds.'],
  teams: ['Teams', 'NFL team schedules, rosters, injuries and season statistics.'],
  picks: ['Picks', 'AFI model spread, total and moneyline picks with a transparent tracked record.'],
  news: ['News', 'NFL news summaries and data stories with links to their sources.'],
  preview: ['Matchup Preview', 'NFL matchup form, injuries, trends, model picks and kickoff weather.'],
  game: ['Game Center', 'NFL game scores, team statistics, leaders and scoring plays.'],
  status: ['Data Status', 'Refresh health, last successful updates and data-source errors.']
};
export const routeMetadata = (pathname) => ROUTES[pathname.split('/')[1]] || [pathname.split('/')[1].replace(/-/g, ' ') || 'Football Insider', 'NFL team information, analysis and live data from Football Insider.'];

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
  meta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary');
  meta('meta[name="twitter:title"]', { name: 'twitter:title' }, document.title);
  meta('meta[name="twitter:description"]', { name: 'twitter:description' }, description);
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
  canonical.href = url;
}

export function usePageMetadata(title, description) {
  useEffect(() => { if (title) setPageMetadata(title, description); }, [title, description]);
}
