import { Link, useSearchParams } from 'react-router-dom';
import { useApi, formatKickoff } from '../api.js';
import { Loading, ErrorBox, Logo, Updated, StaleData } from '../components.jsx';

const LEVEL_LABEL = { none: 'No impact', low: 'Low', medium: 'Moderate', high: 'High' };

function Conditions({ g }) {
  const f = g.forecast;
  if (!f) return <p className="muted small">{g.note || g.error || 'No forecast.'}</p>;
  return (
    <div className="wx-grid">
      <div><span className="wx-big">{Math.round(f.temp_f)}°F</span><span className="muted small">feels {Math.round(f.feels_like_f)}°</span></div>
      <div><b>{Math.round(f.wind_mph)} mph</b> {f.wind_dir}<span className="muted small">gusts {Math.round(f.gusts_mph)}</span></div>
      <div><b>{f.precip_prob}%</b> precip<span className="muted small">{f.snow_in > 0.05 ? `${f.snow_in.toFixed(1)}" snow` : `${f.precip_in.toFixed(2)}" / h`}</span></div>
      <div><b>{f.conditions || '–'}</b><span className="muted small">at kickoff</span></div>
    </div>
  );
}

export function WeatherBlock({ gameId }) {
  const { data, error, loading, retry, stale, lastUpdated } = useApi(`/weather/game/${gameId}`, { timeoutMs: 10000 });
  if (loading) return <div className="card"><Loading label="Loading forecast…" /></div>;
  if (error && !data) return <div className="card"><ErrorBox error={error} onRetry={retry} /></div>;
  const g = data.data;
  return (
    <div className="card">
      {stale && <StaleData at={lastUpdated} />}
      <h3 className="card-title compare-head"><span>Weather</span><span className={`wx-level ${g.impact?.level || 'none'}`}>{g.impact ? LEVEL_LABEL[g.impact.level] : ''}</span></h3>
      <p className="small muted">{g.venue?.name}{g.roof_label ? ` · ${g.roof_label}` : ''}</p>
      {g.roof === 'dome' || g.roof === 'covered' ? <p className="small">{g.impact?.note}</p> : (
        <>
          <Conditions g={g} />
          {g.impact && <p className="small">{g.impact.note}</p>}
        </>
      )}
      <p className="muted small"><Link to="/weather"><u>All games this week →</u></Link></p>
    </div>
  );
}

export default function Weather() {
  const [params] = useSearchParams();
  const week = params.get('week');
  const { data, error, loading, retry, stale, lastUpdated } = useApi(`/weather${week ? `?week=${week}` : ''}`, { timeoutMs: 10000 });
  if (loading) return <Loading label="Loading forecasts…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={retry} />;
  const d = data.data;
  const order = { high: 0, medium: 1, low: 2, none: 3 };
  const games = [...d.games].sort((a, b) => (order[a.impact?.level] ?? 4) - (order[b.impact?.level] ?? 4) || a.date.localeCompare(b.date));
  const flagged = games.filter((g) => ['medium', 'high'].includes(g.impact?.level)).length;

  return (
    <section>
      {stale && <StaleData at={lastUpdated} />}
      <div className="page-head">
        <div>
          <h1>Week {d.week} weather</h1>
          <p className="muted small">Kickoff-hour forecast for every game. {flagged ? `${flagged} game${flagged > 1 ? 's' : ''} with weather impact.` : 'No games with significant weather impact.'}</p>
        </div>
        <div className="tabs">
          {d.week > 1 && <Link className="btn" to={`/weather?week=${d.week - 1}`}>← Week {d.week - 1}</Link>}
          <Link className="btn" to={`/weather?week=${d.week + 1}`}>Week {d.week + 1} →</Link>
        </div>
      </div>
      <div className="grid wx-cards">
        {games.map((g) => (
          <div key={g.game_id} className={`card wx-card ${g.impact?.level || 'none'}`}>
            <div className="game-card-head">
              <span className="pill pre">{formatKickoff(g.date)}</span>
              <span className={`wx-level ${g.impact?.level || 'none'}`}>{g.impact ? LEVEL_LABEL[g.impact.level] : g.state === 'post' ? 'Final' : '–'}</span>
            </div>
            <Link to={`/preview/${g.game_id}`} className="wx-teams">
              <Logo src={g.away?.logo} size={26} /><b>{g.away?.abbreviation}</b><span className="muted">@</span><Logo src={g.home?.logo} size={26} /><b>{g.home?.abbreviation}</b>
            </Link>
            <p className="small muted">{g.venue?.name}{g.venue?.city ? `, ${g.venue.city}` : ''}{g.roof_label ? ` · ${g.roof_label}` : ''}</p>
            {g.roof === 'dome' || g.roof === 'covered' ? <p className="small">Indoors — no weather impact.</p> : <Conditions g={g} />}
            {g.impact && g.impact.level !== 'none' && <p className="small">{g.impact.note}</p>}
            {g.lines?.total != null && <p className="small muted">Total {g.lines.total}{g.lines.details ? ` · ${g.lines.details}` : ''}</p>}
          </div>
        ))}
      </div>
      <p className="muted small note">
        Forecasts: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (hour nearest kickoff, refreshed hourly). Impact flags: wind over 15 mph (or gusts over 30),
        heavy rain or snow, extreme cold (25°F or below) or heat (90°F+). Domes and covered stadiums are unaffected; retractable roofs usually close in bad weather.
      </p>
      <Updated at={d.last_updated} />
    </section>
  );
}
