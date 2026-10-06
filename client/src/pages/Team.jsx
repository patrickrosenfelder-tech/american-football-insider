import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi, formatKickoff } from '../api.js';
import { Loading, ErrorBox, Logo } from '../components.jsx';
import DepthChart from './DepthChart.jsx';
import Roster from './Roster.jsx';
import { TeamInjuries } from './Injuries.jsx';
import { TeamTendencies } from './Tendencies.jsx';

const TABS = [['overview', 'Overview'], ['depth', 'Depth chart'], ['roster', 'Roster'], ['injuries', 'Injuries'], ['tendencies', 'Tendencies']];

function ScheduleRow({ game, teamId }) {
  const us = game.home.id === teamId ? game.home : game.away;
  const them = game.home.id === teamId ? game.away : game.home;
  const isHome = game.home.id === teamId;
  let result = null;
  if (game.status.state === 'post') {
    const tag = us.winner ? 'W' : them.winner ? 'L' : 'T';
    result = <span className={`result ${tag}`}>{tag} {us.score}–{them.score}</span>;
  } else if (game.status.state === 'in') {
    result = <span className="result live-text">{us.score}–{them.score} · {game.status.detail}</span>;
  } else {
    result = <span className="muted">{formatKickoff(game.date)}</span>;
  }
  return (
    <Link to={`/game/${game.game_id}`} className="sched-row">
      <span className="wk">W{game.week}</span>
      <span className="vs">{isHome ? 'vs' : '@'}</span>
      <Logo src={them.logo} size={24} alt="" />
      <span className="grow">{them.name}</span>
      {result}
    </Link>
  );
}

function StatGrid({ categories }) {
  const order = ['scoring', 'passing', 'rushing', 'receiving', 'miscellaneous', 'defensive', 'defensiveInterceptions'];
  return (
    <div className="grid stat-grid">
      {order.filter((k) => categories[k]).map((k) => {
        const cat = categories[k];
        return (
          <div key={k} className="card">
            <h3 className="card-title">{cat.label}</h3>
            <dl className="stat-list">
              {Object.entries(cat.stats).map(([name, s]) => (
                <div key={name}><dt>{s.label}</dt><dd>{s.display}</dd></div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

export default function Team() {
  const { teamId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const team = useApi(`/teams/${teamId}`);

  if (team.loading) return <Loading label="Loading team…" />;
  if (team.error) return <ErrorBox error={team.error} />;
  const t = team.data.data;

  return (
    <section>
      <div className="team-hero" style={{ '--team': t.color || '#1f3a68', '--team-alt': t.alternate_color || '#fff' }}>
        <Logo src={t.logo} size={84} alt={t.name} />
        <div>
          <h1>{t.name}</h1>
          <p>{t.record} · {t.standing_summary || t.division}</p>
          {t.bye_week && <p className="small">Bye: Week {t.bye_week}</p>}
        </div>
      </div>

      <nav className="subnav">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setParams(k === 'overview' ? {} : { tab: k })}>{label}</button>
        ))}
      </nav>

      {tab === 'overview' && <Overview t={t} teamId={teamId} />}
      {tab === 'depth' && <DepthChart teamId={teamId} />}
      {tab === 'roster' && <Roster teamId={teamId} />}
      {tab === 'injuries' && <TeamInjuries teamId={teamId} />}
      {tab === 'tendencies' && <TeamTendencies teamId={teamId} />}
    </section>
  );
}

function Overview({ t, teamId }) {
  const stats = useApi(`/stats/team/${teamId}`);
  return (
    <>
      <h2 className="section-title">Schedule</h2>
      <div className="card list-card">
        {t.schedule.map((g) => <ScheduleRow key={g.game_id} game={g} teamId={t.id} />)}
      </div>

      <h2 className="section-title">Season stats{stats.data?.data?.games_played ? ` · ${stats.data.data.games_played} games` : ''}</h2>
      {stats.loading && <Loading label="Loading stats…" />}
      {stats.error && <ErrorBox error={stats.error} />}
      {stats.data && <StatGrid categories={stats.data.data.categories} />}
    </>
  );
}
