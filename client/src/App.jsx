import { NavLink, Route, Routes } from 'react-router-dom';
import Scores from './pages/Scores.jsx';
import Standings from './pages/Standings.jsx';
import Teams from './pages/Teams.jsx';
import Team from './pages/Team.jsx';
import Game from './pages/Game.jsx';

export default function App() {
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <NavLink to="/" className="brand">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span>Football <b>Insider</b></span>
          </NavLink>
          <nav>
            <NavLink to="/" end>Scores</NavLink>
            <NavLink to="/standings">Standings</NavLink>
            <NavLink to="/teams">Teams</NavLink>
          </nav>
        </div>
      </header>
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Scores />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:teamId" element={<Team />} />
          <Route path="/game/:gameId" element={<Game />} />
          <Route path="*" element={<div className="state">Page not found.</div>} />
        </Routes>
      </main>
      <footer className="wrap footer">
        Live data from ESPN’s public NFL feeds. Not affiliated with the NFL or ESPN.
      </footer>
    </>
  );
}
