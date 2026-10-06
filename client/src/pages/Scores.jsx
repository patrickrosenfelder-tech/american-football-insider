import { useSearchParams } from 'react-router-dom';
import { useApi, isLive, dayKey } from '../api.js';
import { GameCard, Loading, ErrorBox, Logo, Updated } from '../components.jsx';

export default function Scores() {
  const [params, setParams] = useSearchParams();
  const week = params.get('week');
  const seasonType = params.get('seasontype');
  const query = new URLSearchParams();
  if (week) query.set('week', week);
  if (seasonType) query.set('seasontype', seasonType);

  const { data, error, loading } = useApi(`/games?${query}`, {
    refreshMs: 30000,
    shouldRefresh: (body) => body.data.some((g) => isLive(g) || g.status.state === 'pre')
  });

  if (loading && !data) return <Loading label="Loading scoreboard…" />;
  if (error && !data) return <ErrorBox error={error} />;

  const games = data.data;
  const liveCount = games.filter(isLive).length;
  const weekOptions = (data.calendar || [])
    .filter((b) => b.season_type === 2 || b.season_type === 3)
    .flatMap((b) => b.weeks.map((w) => ({ ...w, season_type: b.season_type, key: `${b.season_type}-${w.week}` })));
  const currentKey = `${seasonType || data.season_type}-${week || data.week}`;

  const byDay = games.reduce((acc, g) => {
    const k = dayKey(g.date);
    (acc[k] ||= []).push(g);
    return acc;
  }, {});

  const onWeekChange = (e) => {
    const [st, wk] = e.target.value.split('-');
    setParams(st === '2' ? { week: wk } : { week: wk, seasontype: st });
  };

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{data.season} {data.season_type === 3 ? 'Playoffs' : `Week ${data.week}`}</h1>
          <p className="muted">
            {games.length} games{liveCount > 0 && <> · <span className="live-text">{liveCount} live</span></>}
            {liveCount > 0 && ' · auto-refreshing'}
          </p>
        </div>
        {weekOptions.length > 0 && (
          <label className="week-select">
            <span className="sr-only">Week</span>
            <select value={currentKey} onChange={onWeekChange}>
              {weekOptions.map((w) => (
                <option key={w.key} value={w.key}>{w.label}{w.detail ? ` · ${w.detail}` : ''}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {games.length === 0 && <div className="state">No games scheduled this week.</div>}

      {Object.entries(byDay).map(([day, list]) => (
        <div key={day} className="day-group">
          <h2 className="day-title">{day}</h2>
          <div className="grid games-grid">
            {list.map((g) => <GameCard key={g.game_id} game={g} />)}
          </div>
        </div>
      ))}

      {data.teams_on_bye?.length > 0 && (
        <div className="byes">
          <span className="muted small">On bye:</span>
          {data.teams_on_bye.map((t) => (
            <span key={t.id} className="bye"><Logo src={t.logo} size={20} alt="" />{t.abbreviation}</span>
          ))}
        </div>
      )}
      <Updated at={data.last_updated} />
    </section>
  );
}
