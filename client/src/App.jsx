import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
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
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const route = location.pathname.split('/')[1];
    const titles = { '': 'Scores', news: 'News', social: 'Watch', trades: 'Trades', 'free-agents': 'Free Agents', standings: 'Standings', previews: 'Previews', preview: 'Matchup Preview', picks: 'Picks', model: 'AFI Model', 'power-rankings': 'Power Rankings', weather: 'Weather', playoffs: 'Playoffs', teams: 'Teams', injuries: 'Injuries', tendencies: 'Tendencies', game: 'Game Center', players: 'Player', status: 'Data Status' };
    document.title = `${titles[route] || 'Football Insider'} | AFI`;
    setMoreOpen(false);
  }, [location.pathname]);

  const overflowLinks = [
    ['/trades', 'Trades'], ['/free-agents', 'Free Agents'], ['/model', 'AFI Model'], ['/power-rankings', 'Power Rankings'],
    ['/weather', 'Weather'], ['/playoffs', 'Playoffs'], ['/injuries', 'Injuries'], ['/tendencies', 'Tendencies'], ['/status', 'Data Status']
  ];
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <NavLink to="/" className="brand">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span>Football <b>Insider</b></span>
          </NavLink>
          <nav aria-label="Primary navigation">
            <NavLink to="/" end>Scores</NavLink>
            <NavLink to="/standings">Standings</NavLink>
            <NavLink to="/previews">Schedule</NavLink>
            <NavLink to="/picks">Stats</NavLink>
            <NavLink to="/teams">Teams</NavLink>
            <NavLink to="/news">News</NavLink>
            <NavLink to="/news#social">Watch</NavLink>
            <div className="nav-more-wrap">
              <button className="nav-more" aria-expanded={moreOpen} aria-haspopup="menu" onClick={() => setMoreOpen((open) => !open)}>More</button>
              {moreOpen && <div className="nav-more-menu">{overflowLinks.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}</div>}
            </div>
          </nav>
          <div className="nav-actions" aria-label="Account tools">
            <button className="nav-icon" type="button" aria-label="Search">⌕</button>
            <span className="user-avatar" aria-label="User account">FI</span>
          </div>
        </div>
      </header>
      <main className="wrap">
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
          <Route path="/social" element={<Navigate to="/news#social" replace />} />
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
