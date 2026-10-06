import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api.js';
import { Loading, ErrorBox, Logo, InjuryBadge, Updated } from '../components.jsx';

const STAT_LABELS = {
  completions: 'Completions', attempts: 'Pass attempts', passing_yards: 'Pass yards', passing_tds: 'Pass TD',
  passing_interceptions: 'INT thrown', sacks_suffered: 'Sacks taken', passing_epa: 'Pass EPA', passing_cpoe: 'CPOE',
  carries: 'Carries', rushing_yards: 'Rush yards', rushing_tds: 'Rush TD', rushing_epa: 'Rush EPA',
  receptions: 'Receptions', targets: 'Targets', receiving_yards: 'Rec yards', receiving_tds: 'Rec TD', receiving_epa: 'Rec EPA',
  target_share: 'Target share', def_tackles_solo: 'Solo tackles', def_tackle_assists: 'Assisted tackles',
  def_tackles_for_loss: 'TFL', def_sacks: 'Sacks', def_qb_hits: 'QB hits', def_interceptions: 'Interceptions',
  def_pass_defended: 'Passes defended', def_fumbles_forced: 'Forced fumbles', def_tds: 'Def TD',
  fg_made: 'FG made', fg_att: 'FG att', fg_long: 'FG long', pat_made: 'PAT made', pat_att: 'PAT att',
  pt_att: 'Punts', pt_yards: 'Punt yards', pt_net_yards: 'Net punt yards', pt_inside_20: 'Inside 20',
  punt_returns: 'Punt returns', punt_return_yards: 'PR yards', kickoff_returns: 'Kick returns', kickoff_return_yards: 'KR yards',
  off_snaps: 'Offensive snaps', def_snaps: 'Defensive snaps', st_snaps: 'Special teams snaps', games: 'Games'
};

const fmt = (k, v) => {
  if (v == null) return '–';
  if (k === 'target_share') return `${(v * 100).toFixed(1)}%`;
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toFixed(2);
};

export default function Player() {
  const { playerId } = useParams();
  const { data, error, loading } = useApi(`/players/${playerId}`);
  if (loading) return <Loading label="Loading player…" />;
  if (error) return <ErrorBox error={error} />;
  const p = data.data;
  const stats = Object.entries(p.season_stats || {}).filter(([k, v]) => STAT_LABELS[k] && v);

  return (
    <section>
      <div className="team-hero player-hero" style={{ '--team': p.team?.color || '#1f3a68' }}>
        <img className="player-headshot" src={p.headshot} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        <div className="grow">
          <h1>{p.name} {p.jersey && <span className="muted-inv">#{p.jersey}</span>}</h1>
          <p>{p.position_name}{p.team && <> · <Link to={`/teams/${p.team.abbreviation}`}><u>{p.team.name}</u></Link></>}</p>
          <p className="small">
            {[p.age && `Age ${p.age}`, p.height, p.weight, p.college, p.experience, p.draft].filter(Boolean).join(' · ')}
          </p>
          {p.injury && <p className="small"><InjuryBadge injury={p.injury} /> {p.injury.injury || ''} {p.injury.practice ? `· Practice (Wk ${p.injury.practice_week} report): ${p.injury.practice}` : ''}</p>}
        </div>
      </div>

      <div className="grid two-col">
        <div className="card">
          <h3 className="card-title">{p.season} season stats</h3>
          {stats.length === 0 && p.stats_summary.length === 0 && <p className="muted small">No regular-season stats yet.</p>}
          {p.stats_summary.length > 0 && (
            <dl className="stat-list">
              {p.stats_summary.map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.value} {s.rank && <span className="muted small">({s.rank})</span>}</dd></div>)}
            </dl>
          )}
          {stats.length > 0 && (
            <dl className="stat-list">
              {stats.map(([k, v]) => <div key={k}><dt>{STAT_LABELS[k]}</dt><dd>{fmt(k, v)}</dd></div>)}
            </dl>
          )}
        </div>
        <div className="card">
          <h3 className="card-title">Injury status</h3>
          {!p.injury && <p className="muted small">Not on the current injury report.</p>}
          {p.injury && (
            <dl className="stat-list">
              <div><dt>Status</dt><dd><InjuryBadge injury={p.injury} /> {p.injury.status}</dd></div>
              {p.injury.injury && <div><dt>Injury</dt><dd>{p.injury.injury}</dd></div>}
              {p.injury.practice && <div><dt>Practice (Wk {p.injury.practice_week})</dt><dd>{p.injury.practice}</dd></div>}
            </dl>
          )}
          {p.stats_through_week && <p className="muted small">Season stats through Week {p.stats_through_week} (nflverse).</p>}
        </div>
      </div>
      {p.espn_url && <p className="small"><a href={p.espn_url} target="_blank" rel="noreferrer"><u>ESPN player card</u></a></p>}
      <Updated at={p.last_updated} />
    </section>
  );
}
