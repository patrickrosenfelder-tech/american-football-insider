import { Link, useParams } from 'react-router-dom';
import { useApi, isLive, formatKickoff } from '../api.js';
import { Loading, ErrorBox, Logo, StatusPill, Updated } from '../components.jsx';

const KEY_STATS = ['totalYards', 'netPassingYards', 'rushingYards', 'firstDowns', 'thirdDownEff', 'fourthDownEff',
  'turnovers', 'totalPenaltiesYards', 'possessionTime', 'redZoneAttempts', 'sacksYardsLost', 'yardsPerPlay'];

function Linescore({ game }) {
  const periods = Math.max(game.home.linescores.length, game.away.linescores.length, 4);
  const heads = Array.from({ length: periods }, (_, i) => (i < 4 ? i + 1 : i === 4 ? 'OT' : `OT${i - 3}`));
  return (
    <table className="linescore">
      <thead><tr><th className="left" />{heads.map((h) => <th key={h}>{h}</th>)}<th>T</th></tr></thead>
      <tbody>
        {[game.away, game.home].map((t) => (
          <tr key={t.id}>
            <td className="left"><Logo src={t.logo} size={20} alt="" /> {t.abbreviation}</td>
            {heads.map((h, i) => <td key={h}>{t.linescores[i] ?? '–'}</td>)}
            <td className="total">{t.score ?? '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamStatsCompare({ game }) {
  const [a, b] = [game.away.id, game.home.id].map((id) => game.team_stats.find((t) => t.team.id === id));
  if (!a || !b) return null;
  const rows = KEY_STATS.map((name) => {
    const sa = a.stats.find((s) => s.name === name);
    const sb = b.stats.find((s) => s.name === name);
    return sa && sb ? { name, label: sa.label, a: sa.value, b: sb.value } : null;
  }).filter(Boolean);
  if (!rows.length) return null;
  return (
    <div className="card">
      <h3 className="card-title compare-head">
        <span>{game.away.abbreviation}</span><span>Team stats</span><span>{game.home.abbreviation}</span>
      </h3>
      {rows.map((r) => (
        <div key={r.name} className="compare-row"><b>{r.a}</b><span className="muted">{r.label}</span><b>{r.b}</b></div>
      ))}
    </div>
  );
}

export default function Game() {
  const { gameId } = useParams();
  const { data, error, loading } = useApi(`/games/${gameId}`, {
    refreshMs: 30000,
    shouldRefresh: (body) => isLive(body.data)
  });

  if (loading && !data) return <Loading label="Loading game…" />;
  if (error && !data) return <ErrorBox error={error} />;
  const g = data.data;
  const started = g.status.state !== 'pre';

  return (
    <section>
      <div className="card game-hero">
        <div className="hero-status"><StatusPill game={g} />{isLive(g) && <span className="muted small">auto-refreshing</span>}{g.status.state === 'pre' && <Link className="small" to={`/preview/${g.game_id}`}><u>Matchup preview</u></Link>}</div>
        <div className="hero-teams">
          {[g.away, g.home].map((t, i) => (
            <Link key={t.id} to={`/teams/${t.abbreviation}`} className={`hero-team ${g.status.state === 'post' && !t.winner ? 'lost' : ''}`}>
              <Logo src={t.logo} size={72} alt={t.name} />
              <span className="hero-name">{t.short_name}</span>
              <span className="muted small">{t.record} · {i === 0 ? 'Away' : 'Home'}</span>
              {started && <span className="hero-score">{t.score}</span>}
            </Link>
          ))}
        </div>
        {isLive(g) && (g.down_distance || g.last_play) && (
          <div className="situation">{g.down_distance}{g.last_play && <div className="muted small">Last play: {g.last_play}</div>}</div>
        )}
        <div className="hero-meta muted small">
          {formatKickoff(g.date)}
          {g.venue?.name && ` · ${g.venue.name}${g.venue.city ? `, ${g.venue.city}` : ''}`}
          {g.broadcast && ` · ${g.broadcast}`}
          {g.odds && ` · Line: ${g.odds}`}
          {g.weather && ` · ${g.weather}`}
        </div>
      </div>

      {started && <div className="card table-card"><Linescore game={g} /></div>}

      <div className="grid two-col">
        {started && <TeamStatsCompare game={g} />}
        {g.player_leaders.length > 0 && (
          <div className="card">
            <h3 className="card-title">{started ? 'Game leaders' : 'Season leaders'}</h3>
            {g.player_leaders.map((tl) => (
              <div key={tl.team.id} className="leader-team">
                <div className="leader-team-name"><Logo src={tl.team.logo} size={20} alt="" /> {tl.team.abbreviation}</div>
                {tl.categories.slice(0, 3).map((c) => (
                  <div key={c.category} className="leader">
                    {c.headshot ? <img src={c.headshot} alt="" className="headshot" loading="lazy" /> : <span className="headshot" />}
                    <div><div><b>{c.athlete}</b> <span className="muted small">{c.category}</span></div><div className="small">{c.value}</div></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {g.scoring_plays.length > 0 && (
        <>
          <h2 className="section-title">Scoring plays</h2>
          <div className="card list-card">
            {g.scoring_plays.map((p) => (
              <div key={p.id} className="play">
                <Logo src={p.team?.logo} size={24} alt="" />
                <div className="grow">
                  <div><b>{p.type}</b> <span className="muted small">Q{p.period} {p.clock}</span></div>
                  <div className="small">{p.text}</div>
                </div>
                <span className="play-score">{p.away_score}–{p.home_score}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {g.news.length > 0 && (
        <>
          <h2 className="section-title">News</h2>
          <div className="card list-card">
            {g.news.map((n) => (
              <a key={n.headline} href={n.url || '#'} target="_blank" rel="noreferrer" className="news">
                <b>{n.headline}</b>
                {n.description && <div className="muted small">{n.description}</div>}
              </a>
            ))}
          </div>
        </>
      )}
      <Updated at={g.fetched_at} />
    </section>
  );
}
