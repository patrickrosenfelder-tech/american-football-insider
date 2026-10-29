import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { setPageMetadata, routeMetadata, usePageMetadata } from './metadata.js';
import Scores from './pages/Scores.jsx';
import Standings from './pages/Standings.jsx';
import Teams from './pages/Teams.jsx';
import Team from './pages/Team.jsx';
import Game from './pages/Game.jsx';
import Player from './pages/Player.jsx';
import Injuries from './pages/Injuries.jsx';
import Preview from './pages/Preview.jsx';
import TendenciesPage from './pages/Tendencies.jsx';
import Playoffs from './pages/Playoffs.jsx';
import News, { NewsStory } from './pages/News.jsx';
import Weather, { GameWeather } from './pages/Weather.jsx';
import Picks from './pages/Picks.jsx';
import Model from './pages/Model.jsx';
import PowerRankings from './pages/PowerRankings.jsx';
import Trades from './pages/Trades.jsx';
import FreeAgents from './pages/FreeAgents.jsx';
import Status from './pages/Status.jsx';
import Elo from './pages/Elo.jsx';
import Accuracy from './pages/Accuracy.jsx';

function NotFound() {
  usePageMetadata('Page not found', 'The page you requested does not exist on Football Insider.');
  return <div className="state"><h1>Page not found</h1><p>That page doesn’t exist. <NavLink to="/"><u>Go to this week’s games</u></NavLink></p></div>;
}

// Primary navigation: five sections, each a dropdown. Keep in sync with NAV in src/services/pageMetadata.js.
const NAV_GROUPS = [
  { label: 'Games', items: [['/', 'Scores'], ['/?view=schedule', 'Matchup previews'], ['/weather', 'Weather']] },
  { label: 'Standings', items: [['/standings', 'Standings'], ['/playoffs', 'Playoffs']] },
  { label: 'Model', items: [['/picks', 'Picks'], ['/elo', 'Elo ratings'], ['/power-rankings', 'Power Rankings'], ['/accuracy', 'Accuracy vs Vegas'], ['/model', 'How the model works']] },
  { label: 'Teams', items: [['/teams', 'All teams'], ['/injuries', 'Injuries'], ['/teams?tab=depth', 'Depth charts'], ['/tendencies', 'Tendencies']] },
  { label: 'News', items: [['/news', 'News'], ['/trades', 'Trades'], ['/free-agents', 'Free agents']] }
];

const itemMatches = (to, location) => {
  const [path, query = ''] = to.split('?');
  if (query) return location.pathname === path && location.search === `?${query}`;
  if (path === '/') return location.pathname === '/' && !location.search.includes('view=schedule');
  if (path === '/teams') return location.pathname === '/teams' ? !location.search.includes('tab=depth') : location.pathname.startsWith('/teams/');
  return location.pathname === path || location.pathname.startsWith(`${path}/`);
};
const groupActive = (group, location) => group.items.some(([to]) => itemMatches(to, location))
  || (group.label === 'Games' && /^\/(game|preview|weather)\//.test(location.pathname))
  || (group.label === 'News' && location.pathname.startsWith('/news/'));

function SiteSearch({ onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResult(null); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json()).then((body) => { if (live && body.success) setResult(body.data); }).catch(() => {});
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [q]);
  const go = (url) => { navigate(url); onClose(); };
  const items = result ? [
    ...result.teams.map((t) => ({ key: `t${t.id}`, url: t.url, label: t.name, kind: 'Team', logo: t.logo })),
    ...result.players.map((p) => ({ key: `p${p.id}`, url: p.url, label: p.name, kind: [p.position, p.team].filter(Boolean).join(' · ') })),
    ...result.games.map((g) => ({ key: `g${g.id}`, url: g.url, label: g.name, kind: g.detail || 'Game' }))
  ] : [];
  return (
    <form className="global-search" role="search" onSubmit={(event) => { event.preventDefault(); const query = q.trim(); if (!query) return; go(items[0]?.url || `/news?q=${encodeURIComponent(query)}`); }}>
      <input autoFocus type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Teams, players, games…" aria-label="Search teams, players and games" aria-controls="search-results" />
      <button type="button" className="search-close" onClick={onClose} aria-label="Close search">×</button>
      {q.trim().length >= 2 && (
        <div className="search-results" id="search-results" role="listbox">
          {items.map((it) => (
            <button type="button" role="option" aria-selected="false" key={it.key} className="search-result" onClick={() => go(it.url)}>
              {it.logo ? <img src={it.logo} alt="" width="20" height="20" /> : <span className="search-dot" aria-hidden="true" />}
              <span className="grow">{it.label}</span><span className="muted small">{it.kind}</span>
            </button>
          ))}
          {result && !items.length && <div className="search-empty muted small">No teams, players or games match.</div>}
          <button type="button" className="search-result search-news" onClick={() => go(`/news?q=${encodeURIComponent(q.trim())}`)}>Search news for “{q.trim()}”</button>
        </div>
      )}
    </form>
  );
}

export default function App() {
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState(null); // group label, 'mobile', or null
  const [searchOpen, setSearchOpen] = useState(false);
  const headerRef = useRef(null);
  const menuRef = useRef(null);
  useLayoutEffect(() => { setPageMetadata(...routeMetadata(location.pathname)); }, [location.pathname]);
  useEffect(() => {
    setOpenMenu(null);
    setSearchOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key === 'Escape' && (openMenu || searchOpen)) { setOpenMenu(null); setSearchOpen(false); menuRef.current?.focus(); }
      if (event.type === 'pointerdown' && !headerRef.current?.contains(event.target)) { setOpenMenu(null); setSearchOpen(false); }
    };
    document.addEventListener('keydown', dismiss); document.addEventListener('pointerdown', dismiss);
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', dismiss); };
  }, [openMenu, searchOpen]);
  const toggle = (key) => { setSearchOpen(false); setOpenMenu((open) => (open === key ? null : key)); };
  const menuLink = ([to, label]) => <NavLink key={to} to={to} className={() => (itemMatches(to, location) ? 'active' : '')} aria-current={itemMatches(to, location) ? 'page' : undefined}>{label}</NavLink>;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="topbar" ref={headerRef}>
        <div className="wrap topbar-inner">
          <NavLink to="/" className="brand" aria-label="Football Insider home">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span>Football <b>Insider</b></span>
          </NavLink>
          <nav aria-label="Primary navigation" className="nav-groups">
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <button type="button" className={`nav-group-button ${groupActive(group, location) ? 'active' : ''}`} aria-expanded={openMenu === group.label} aria-controls={`menu-${group.label}`} onClick={() => toggle(group.label)}>{group.label}<span className="caret" aria-hidden="true">▾</span></button>
                {openMenu === group.label && <div className="nav-dropdown" id={`menu-${group.label}`}>{group.items.map(menuLink)}</div>}
              </div>
            ))}
            <button ref={menuRef} type="button" className="nav-mobile-button" aria-expanded={openMenu === 'mobile'} aria-controls="mobile-menu" onClick={() => toggle('mobile')}>Menu</button>
            {openMenu === 'mobile' && (
              <div className="nav-mobile-menu" id="mobile-menu">
                {NAV_GROUPS.map((group) => <div className="nav-mobile-group" key={group.label}><div className="nav-mobile-heading">{group.label}</div>{group.items.map(menuLink)}</div>)}
              </div>
            )}
          </nav>
          <div className="nav-actions">
            {searchOpen ? <SiteSearch onClose={() => setSearchOpen(false)} />
              : <button className="nav-icon" type="button" aria-label="Search teams, players and games" onClick={() => { setOpenMenu(null); setSearchOpen(true); }}>⌕</button>}
          </div>
        </div>
      </header>
      <main className="wrap" id="main-content" tabIndex="-1">
        <Routes>
          <Route path="/" element={<Scores />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:teamId" element={<Team />} />
          <Route path="/game/:gameId" element={<Game />} />
          <Route path="/players/:playerId" element={<Player />} />
          <Route path="/injuries" element={<Injuries />} />
          <Route path="/previews" element={<Navigate to="/?view=schedule" replace />} />
          <Route path="/preview/:gameId" element={<Preview />} />
          <Route path="/tendencies" element={<TendenciesPage />} />
          <Route path="/playoffs" element={<Playoffs />} />
          <Route path="/news" element={<News />} />
          <Route path="/social" element={<Navigate to="/news#social" replace />} />
          <Route path="/weather/game/:gameId" element={<GameWeather />} />
          <Route path="/weather" element={<Weather />} />
          <Route path="/picks" element={<Picks />} />
          <Route path="/model" element={<Model />} />
          <Route path="/power-rankings" element={<PowerRankings />} />
          <Route path="/elo" element={<Elo />} />
          <Route path="/accuracy" element={<Accuracy />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/free-agents" element={<FreeAgents />} />
          <Route path="/status" element={<Status />} />
          <Route path="/news/:storyId" element={<NewsStory />} />
          <Route path="*" element={<NotFound key={location.pathname} />} />
        </Routes>
      </main>
      <footer className="wrap footer">
        Live data from ESPN’s public NFL feeds and nflverse. Not affiliated with the NFL, ESPN or EA. · <NavLink to="/status">Data status</NavLink>
      </footer>
    </>
  );
}
