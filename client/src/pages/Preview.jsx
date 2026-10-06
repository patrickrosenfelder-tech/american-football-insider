import { Link, useParams } from 'react-router-dom';
import { useApi, formatKickoff } from '../api.js';
import { Loading, ErrorBox, Logo, InjuryBadge, Updated } from '../components.jsx';
import { MatchupTendencies } from './Tendencies.jsx';
import { WeatherBlock } from './Weather.jsx';
import { TrendsBlock } from './Picks.jsx';

// [label, path, higherIsBetter, suffix]
const STAT_ROWS = [
  ['Points / game', 'offense.points_per_game', true],
  ['Points allowed / game', 'defense.points_per_game', false],
  ['Off. yards / game', 'offense.yards_per_game', true],
  ['Def. yards allowed / game', 'defense.yards_per_game', false],
  ['Off. yards / play', 'offense.yards_per_play', true],
  ['Turnovers (giveaways)', 'offense.turnovers', false],
  ['Takeaways', 'defense.turnovers', true],
  ['Turnover margin', 'turnover_margin', true],
  ['3rd down conv. %', 'offense.third_down_pct', true, '%'],
  ['Opp. 3rd down conv. %', 'defense.third_down_pct', false, '%'],
  ['Red zone TD %', 'offense.red_zone_td_pct', true, '%'],
  ['Opp. red zone TD %', 'defense.red_zone_td_pct', false, '%'],
  ['Off. EPA / play', 'offense.epa_per_play', true],
  ['Def. EPA / play allowed', 'defense.epa_per_play', false]
];

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function Compare({ away, home, rows, title, note }) {
  return (
    <div className="card">
      <h3 className="card-title compare-head"><span>{away.abbreviation}</span><span>{title}</span><span>{home.abbreviation}</span></h3>
      {rows.map(([label, a, b, higher, suffix = '']) => {
        const better = a == null || b == null || a === b || higher == null ? null : (a > b) === higher ? 'a' : 'b';
        return (
          <div key={label} className="compare-row">
            <b className={better === 'a' ? 'better' : ''}>{a ?? '–'}{a != null ? suffix : ''}</b>
            <span className="muted">{label}</span>
            <b className={better === 'b' ? 'better' : ''}>{b ?? '–'}{b != null ? suffix : ''}</b>
          </div>
        );
      })}
      {note && <p className="muted small note">{note}</p>}
    </div>
  );
}

function QbCard({ side }) {
  const qb = side.starting_qb;
  if (!qb) return <div className="muted small">No QB on depth chart.</div>;
  const s = qb.season;
  return (
    <div className="qb-card">
      <img className="headshot" src={qb.headshot} alt="" />
      <div className="grow">
        <div><Link to={`/players/${qb.id}`}><b>{qb.name}</b></Link> <InjuryBadge injury={qb.injury} small /></div>
        <div className="small muted">
          {s.attempts ? `${s.completions}/${s.attempts}, ${s.passing_yards} yds, ${s.passing_tds ?? 0} TD, ${s.interceptions ?? 0} INT` : 'No pass attempts yet this season'}
        </div>
        {qb.replaces && <div className="small warn">Replaces {qb.replaces.name} ({qb.replaces.injury?.status}{qb.replaces.injury?.injury ? `, ${qb.replaces.injury.injury}` : ''})</div>}
      </div>
    </div>
  );
}

function Form({ side }) {
  if (!side.recent_form.length) return <span className="muted small">No games yet</span>;
  return (
    <div className="form-row">
      {side.recent_form.map((g) => (
        <Link key={g.game_id} to={`/game/${g.game_id}`} className={`form-chip ${g.result}`} title={`Week ${g.week}: ${g.home ? 'vs' : '@'} ${g.opponent} ${g.score}`}>
          <span>{g.result}</span><small>{g.home ? 'vs' : '@'}{g.opponent}</small><small>{g.score}</small>
        </Link>
      ))}
    </div>
  );
}

function Injuries({ side }) {
  if (!side.key_injuries.length) return <p className="muted small">No key injuries reported.</p>;
  return side.key_injuries.map((i) => (
    <div key={i.athlete_id || i.name} className="inj-line">
      <InjuryBadge injury={i} small />
      <span className="grow">{i.athlete_id ? <Link to={`/players/${i.athlete_id}`}><b>{i.name}</b></Link> : <b>{i.name}</b>} <span className="muted small">{i.position}{i.starter ? ' · starter' : ''}</span></span>
      <span className="muted small">{i.injury}</span>
    </div>
  ));
}

export default function Preview() {
  const { gameId } = useParams();
  const { data, error, loading } = useApi(`/previews/${gameId}`);
  if (loading) return <Loading label="Building matchup preview…" />;
  if (error) return <ErrorBox error={error} />;
  const p = data.data;
  const { away, home } = p;
  const statRows = STAT_ROWS.map(([label, path, higher, suffix]) => [label, get(away.stats, path), get(home.stats, path), higher, suffix]);

  return (
    <section>
      <div className="card game-hero">
        <div className="hero-status"><span className="pill pre">Week {p.week} preview</span>{p.status !== 'pre' && <Link className="small" to={`/game/${p.game_id}`}><u>Game center</u></Link>}</div>
        <div className="hero-teams">
          {[away, home].map((t, i) => (
            <Link key={t.id} to={`/teams/${t.abbreviation}`} className="hero-team">
              <Logo src={t.logo} size={72} alt={t.name} />
              <span className="hero-name">{t.name}</span>
              <span className="muted small">{t.standing?.record} · {t.standing?.summary}{t.standing?.streak ? ` · ${t.standing.streak}` : ''} · {i === 0 ? 'Away' : 'Home'}</span>
            </Link>
          ))}
        </div>
        <div className="hero-meta muted small">
          {formatKickoff(p.date)}
          {p.venue?.name && ` · ${p.venue.name}${p.venue.city ? `, ${p.venue.city}` : ''}`}
          {p.broadcast && ` · ${p.broadcast}`}
        </div>
        {(p.odds || p.predictor) && (
          <div className="odds-row">
            {p.odds?.details && <span><b>Spread</b> {p.odds.details}{p.odds.open_spread_home ? <span className="muted"> (open {home.abbreviation} {p.odds.open_spread_home})</span> : ''}</span>}
            {p.odds?.over_under && <span><b>O/U</b> {p.odds.over_under}{p.odds.open_total ? <span className="muted"> (open {p.odds.open_total})</span> : ''}</span>}
            {p.odds?.away_moneyline != null && <span><b>ML</b> {away.abbreviation} {p.odds.away_moneyline > 0 ? '+' : ''}{p.odds.away_moneyline} / {home.abbreviation} {p.odds.home_moneyline > 0 ? '+' : ''}{p.odds.home_moneyline}</span>}
            {p.predictor?.home_win_pct && <span><b>ESPN win prob.</b> {away.abbreviation} {p.predictor.away_win_pct}% / {home.abbreviation} {p.predictor.home_win_pct}%</span>}
            {p.odds?.provider && <span className="muted small">Lines: {p.odds.provider} via ESPN</span>}
          </div>
        )}
      </div>

      <div className="grid two-col">
        {[away, home].map((t) => (
          <div key={t.id} className="card">
            <h3 className="card-title team-title"><Logo src={t.logo} size={20} alt="" /> {t.abbreviation} · starting QB</h3>
            <QbCard side={t} />
            <h3 className="card-title mt">Recent form</h3>
            <Form side={t} />
            <h3 className="card-title mt">Key injuries</h3>
            <Injuries side={t} />
          </div>
        ))}
      </div>

      <TrendsBlock gameId={p.game_id} away={away} home={home} />

      <div className="grid two-col">
        <WeatherBlock gameId={p.game_id} />
      </div>

      <div className="grid two-col">
        {away.stats && home.stats
          ? <Compare away={away} home={home} rows={statRows} title="Team stats" note={`Season to date${p.team_stats_through_week ? `, through Week ${p.team_stats_through_week}` : ''} (nflverse play-by-play). Green = better.`} />
          : <div className="card muted small">Team stats not loaded yet.</div>}
        <div className="card">
          <h3 className="card-title">Head-to-head</h3>
          {!p.head_to_head?.total && <p className="muted small">No meetings since 1999.</p>}
          {p.head_to_head?.total > 0 && (
            <>
              <p className="small">Since 1999: <b>{away.abbreviation} {p.head_to_head.all_time_since_1999[away.abbreviation]}</b> – <b>{home.abbreviation} {p.head_to_head.all_time_since_1999[home.abbreviation]}</b>{p.head_to_head.all_time_since_1999.ties ? ` – ${p.head_to_head.all_time_since_1999.ties} tie(s)` : ''}</p>
              {p.head_to_head.recent.map((g) => (
                <div key={`${g.season}-${g.week}`} className="h2h-row small">
                  <span className="muted">{g.season} {g.game_type === 'REG' ? `Wk ${g.week}` : g.game_type}</span>
                  <span className="grow">{g.away} {g.away_score} @ {g.home} {g.home_score}</span>
                  <span className="muted">{g.date}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <MatchupTendencies away={away} home={home} />
      <Updated at={p.last_updated} />
    </section>
  );
}
