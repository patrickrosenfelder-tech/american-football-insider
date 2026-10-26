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

function NotFound() {
  usePageMetadata('Page not found', 'The page you requested does not exist on Football Insider.');
  return <div className="state"><h1>Page not found</h1><p>That page doesn’t exist. <NavLink to="/"><u>Go to this week’s games</u></NavLink></p></div>;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const headerRef = useRef(null);
  const menuRef = useRef(null);
  useLayoutEffect(() => { setPageMetadata(...routeMetadata(location.pathname)); }, [location.pathname]);
  useEffect(() => {
    setMoreOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key === 'Escape' && (moreOpen || searchOpen)) { setMoreOpen(false); setSearchOpen(false); menuRef.current?.focus(); }
      if (event.type === 'pointerdown' && !headerRef.current?.contains(event.target)) { setMoreOpen(false); setSearchOpen(false); }
    };
    document.addEventListener('keydown', dismiss); document.addEventListener('pointerdown', dismiss);
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', dismiss); };
  }, [moreOpen, searchOpen]);

  const overflowLinks = [
    ['/trades', 'Trades'], ['/free-agents', 'Free Agents'], ['/model', 'AFI Model'], ['/power-rankings', 'Power Rankings'], ['/previews', 'Matchup previews'],
    ['/weather', 'Weather'], ['/playoffs', 'Playoffs'], ['/injuries', 'Injuries'], ['/tendencies', 'Tendencies'], ['/status', 'Data Status']
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
            <NavLink to="/" end>Games</NavLink>
            <NavLink to="/standings">Standings</NavLink>
            <NavLink to="/picks">Picks</NavLink>
            <NavLink to="/teams">Teams</NavLink>
            <NavLink to="/news">News</NavLink>
            <div className="nav-more-wrap">
              <button ref={menuRef} className="nav-more" aria-expanded={moreOpen} aria-controls="navigation-menu" onClick={() => setMoreOpen((open) => !open)}>More</button>
              {moreOpen && <div className="nav-more-menu" id="navigation-menu">{[['/', 'Games'], ['/standings', 'Standings'], ['/picks', 'Picks'], ['/teams', 'Teams'], ['/news', 'News']].map(([to, label]) => <NavLink className="mobile-nav-link" key={to} to={to} end={to === '/'}>{label}</NavLink>)}{overflowLinks.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}</div>}
            </div>
          </nav>
          <div className="nav-actions" aria-label="Account tools">
            {searchOpen ? (
              <form className="global-search" onSubmit={(event) => { event.preventDefault(); const q = searchQuery.trim(); if (q) navigate(`/news?q=${encodeURIComponent(q)}`); setSearchOpen(false); }}>
                <input autoFocus type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search news…" aria-label="Search news" />
                <button type="button" className="search-close" onClick={() => setSearchOpen(false)} aria-label="Close search">×</button>
              </form>
            ) : (
              <button className="nav-icon" type="button" aria-label="Search news" onClick={() => setSearchOpen(true)}>⌕</button>
            )}
            <span className="user-avatar" aria-label="User account">FI</span>
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
          <Route path="/trades" element={<Trades />} />
          <Route path="/free-agents" element={<FreeAgents />} />
          <Route path="/status" element={<Status />} />
          <Route path="/news/:storyId" element={<NewsStory />} />
          <Route path="*" element={<NotFound key={location.pathname} />} />
        </Routes>
      </main>
      <footer className="wrap footer">
        Live data from ESPN’s public NFL feeds and nflverse. Not affiliated with the NFL, ESPN or EA.
      </footer>
    </>
  );
}
