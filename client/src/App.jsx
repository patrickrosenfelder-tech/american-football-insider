import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { setPageMetadata, routeMetadata } from './metadata.js';
import Scores from './pages/Scores.jsx';
import Standings from './pages/Standings.jsx';
import Teams from './pages/Teams.jsx';
import Team from './pages/Team.jsx';
import Game from './pages/Game.jsx';
import Player from './pages/Player.jsx';
import Injuries from './pages/Injuries.jsx';
import Previews from './pages/Previews.jsx';
import Preview from './pages/Preview.jsx';
import TendenciesPage from './pages/Tendencies.jsx';
import Playoffs from './pages/Playoffs.jsx';
import News, { NewsStory } from './pages/News.jsx';
import Weather from './pages/Weather.jsx';
import Picks from './pages/Picks.jsx';
import Model from './pages/Model.jsx';
import PowerRankings from './pages/PowerRankings.jsx';
import Trades from './pages/Trades.jsx';
import FreeAgents from './pages/FreeAgents.jsx';
import Status from './pages/Status.jsx';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const headerRef = useRef(null);
  const menuRef = useRef(null);
  useLayoutEffect(() => {
    setPageMetadata(...routeMetadata(location.pathname));
  }, [location.pathname]);
  useLayoutEffect(() => {
    setMoreOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const close = (e) => {
      if (e.type === 'keydown' && e.key === 'Escape' && (moreOpen || searchOpen)) { setMoreOpen(false); setSearchOpen(false); menuRef.current?.focus(); }
      if (e.type === 'pointerdown' && !headerRef.current?.contains(e.target)) { setMoreOpen(false); setSearchOpen(false); }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close); };
  }, [moreOpen, searchOpen]);

  const primaryLinks = [['/', 'Games'], ['/standings', 'Standings'], ['/picks', 'Picks'], ['/teams', 'Teams'], ['/news', 'News']];
  const overflowLinks = [
    ['/trades', 'Trades'], ['/free-agents', 'Free Agents'], ['/model', 'AFI Model'], ['/power-rankings', 'Power Rankings'], ['/previews', 'Matchup previews'], ['/weather', 'Weather'], ['/playoffs', 'Playoffs'], ['/injuries', 'Injuries'], ['/tendencies', 'Tendencies'], ['/status', 'Data Status']
  ];
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="topbar" ref={headerRef}>
        <div className="wrap topbar-inner">
          <NavLink to="/" className="brand" aria-label="Football Insider home">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span>Football <b>Insider</b></span>
          </NavLink>
          <nav aria-label="Primary navigation">
            {primaryLinks.map(([to, label]) => <NavLink key={to} className="nav-primary" to={to} end={to === '/'}>{label}</NavLink>)}
            <div className="nav-more-wrap">
              <button ref={menuRef} className="nav-more" aria-expanded={moreOpen} aria-controls="navigation-menu" onClick={() => setMoreOpen((open) => !open)}><span className="desktop-label">More</span><span className="mobile-label">Menu</span></button>
              {moreOpen && <div className="nav-more-menu" id="navigation-menu">{primaryLinks.map(([to, label]) => <NavLink className="mobile-only" key={to} to={to} end={to === '/'}>{label}</NavLink>)}{overflowLinks.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}</div>}
            </div>
          </nav>
          <div className="nav-actions">
            <button className="nav-icon" type="button" aria-label={searchOpen ? 'Close search' : 'Search news'} aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}>⌕</button>
          </div>
        </div>
        {searchOpen && <form className="wrap header-search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/news${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`); }}><label htmlFor="news-search">Search news</label><input id="news-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /><button className="btn" type="submit">Search</button></form>}
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
          <Route path="/previews" element={<Previews />} />
          <Route path="/preview/:gameId" element={<Preview />} />
          <Route path="/tendencies" element={<TendenciesPage />} />
          <Route path="/playoffs" element={<Playoffs />} />
          <Route path="/news" element={<News />} />
          <Route path="/social" element={<Navigate to="/news" replace />} />
          <Route path="/weather" element={<Weather />} />
          <Route path="/picks" element={<Picks />} />
          <Route path="/model" element={<Model />} />
          <Route path="/power-rankings" element={<PowerRankings />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/free-agents" element={<FreeAgents />} />
          <Route path="/status" element={<Status />} />
          <Route path="/news/:storyId" element={<NewsStory />} />
          <Route path="*" element={<div className="state">Page not found.</div>} />
        </Routes>
      </main>
      <footer className="wrap footer">
        Live data from ESPN’s public NFL feeds and nflverse. Not affiliated with the NFL, ESPN or EA.
      </footer>
    </>
  );
}
