import { Link, useSearchParams } from 'react-router-dom';
import { useApi, formatKickoff, dayKey } from '../api.js';
import { Loading, ErrorBox, Logo } from '../components.jsx';

export default function Previews() {
  const [params] = useSearchParams();
  const week = params.get('week');
  const { data, error, loading } = useApi(`/previews${week ? `?week=${week}` : ''}`);
  if (loading) return <Loading label="Loading matchups…" />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  const byDay = d.games.reduce((acc, g) => { (acc[dayKey(g.date)] ||= []).push(g); return acc; }, {});

  return (
    <section>
      <div className="page-head">
        <div><h1>Week {d.week} matchup previews</h1><p className="muted small">Records, injuries, starting QBs, stat comparison, recent form, head-to-head, scheme tendencies and lines.</p></div>
        <div className="tabs">
          {d.week > 1 && <Link className="btn" to={`/previews?week=${d.week - 1}`}>← Week {d.week - 1}</Link>}
          <Link className="btn" to={`/previews?week=${d.week + 1}`}>Week {d.week + 1} →</Link>
        </div>
      </div>
      {Object.entries(byDay).map(([day, games]) => (
        <div key={day}>
          <h2 className="day-title">{day}</h2>
          <div className="grid games-grid">
            {games.map((g) => (
              <Link key={g.game_id} to={`/preview/${g.game_id}`} className="card game-card">
                <div className="game-card-head"><span className="pill pre">{formatKickoff(g.date)}</span>{g.broadcast && <span className="muted small">{g.broadcast}</span>}</div>
                {[g.away, g.home].map((t) => (
                  <div key={t.id} className="team-row">
                    <Logo src={t.logo} alt="" />
                    <span className="team-name"><span className="full">{t.name}</span><span className="record">{t.record}</span></span>
                  </div>
                ))}
                <div className="muted small">{g.odds ? `Line: ${g.odds} · ` : ''}<b className="link-text">Preview →</b></div>
              </Link>
            ))}
          </div>
        </div>
      ))}
      {d.teams_on_bye?.length > 0 && <p className="muted small">On bye: {d.teams_on_bye.map((t) => t.abbreviation).join(', ')}</p>}
    </section>
  );
}
