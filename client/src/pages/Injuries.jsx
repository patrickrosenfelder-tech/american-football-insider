import { formatShortDate } from '../dates.js';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.js';
import { Loading, PageSkeleton, ErrorBox, Logo, InjuryBadge, Updated } from '../components.jsx';

const fmtDate = (iso) => formatShortDate(iso);

export function InjuryTable({ injuries }) {
  if (!injuries.length) return <p className="muted small pad">No players on the injury report.</p>;
  return (
    <table className="inj-table">
      <thead>
        <tr><th className="left">Player</th><th>Pos</th><th>Status</th><th className="left">Injury</th><th className="left hide-sm">Practice (last official report)</th><th className="hide-sm">Est. return</th><th>Updated</th></tr>
      </thead>
      <tbody>
        {injuries.map((i) => (
          <tr key={`${i.athlete_id}-${i.status}`} title={i.comment || ''}>
            <td className="left">
              {i.athlete_id ? <Link to={`/players/${i.athlete_id}`} className="player-cell"><b>{i.name}</b></Link> : <b>{i.name}</b>}
            </td>
            <td>{i.position}</td>
            <td><InjuryBadge injury={i} /> <span className="hide-sm small">{i.status}</span></td>
            <td className="left">{i.injury || '–'}</td>
            <td className="left hide-sm small">{i.practice ? `${i.practice} (Wk ${i.practice_report_week})` : '–'}</td>
            <td className="hide-sm small">{fmtDate(i.return_date)}</td>
            <td className="small">{fmtDate(i.updated)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TeamInjuries({ teamId }) {
  const { data, error, loading } = useApi(`/teams/${teamId}/injuries`);
  if (loading) return <Loading label="Loading injuries…" />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  return (
    <div>
      <div className="card table-card"><InjuryTable injuries={d.injuries} /></div>
      <SourceNote week={d.practice_report_week} />
      <Updated at={d.last_updated} />
    </div>
  );
}

function SourceNote({ week }) {
  return (
    <p className="muted small note">
      Status from ESPN’s injury feed (refreshed hourly). Practice participation is from the NFL’s official injury report via nflverse
      {week ? `; latest report available: Week ${week}` : ''}. Reports for the upcoming week appear from Wednesday.
    </p>
  );
}

const FILTERS = ['All', 'Out', 'Doubtful', 'Questionable', 'Injured Reserve'];

export default function Injuries() {
  const [filter, setFilter] = useState('All');
  const [params, setParams] = useSearchParams();
  // ?team=BUF or ?team=BUF,KC (game cards link to the two teams of a matchup)
  const teamFilter = (params.get('team') || '').toUpperCase().split(',').filter(Boolean);
  const { data, error, loading } = useApi('/injuries');
  if (loading) return <PageSkeleton label="Loading injury report…" tables={3} />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  const counts = teamFilter.length
    ? d.teams.filter((t) => teamFilter.includes(t.team.abbreviation)).flatMap((t) => t.injuries).reduce((acc, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }), {})
    : d.counts;
  const teams = d.teams
    .filter((t) => !teamFilter.length || teamFilter.includes(t.team.abbreviation))
    .map((t) => ({ ...t, injuries: filter === 'All' ? t.injuries : t.injuries.filter((i) => i.status === filter) }))
    .filter((t) => t.injuries.length);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{teamFilter.length ? `${teamFilter.join(' & ')} injury report` : 'Injury report'}</h1>
          <p className="muted small">{Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}</p>
        </div>
        <div className="tabs">
          {FILTERS.map((f) => <button key={f} type="button" className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>)}
        </div>
      </div>
      {teamFilter.length > 0 && <div className="filter-banner"><b>Showing:</b> {teamFilter.join(', ')} <button className="link-btn" onClick={() => { const next = new URLSearchParams(params); next.delete('team'); setParams(next, { replace: true }); }}>✕ Show all teams</button></div>}
      {!teams.length && <div className="state">No players on the injury report{teamFilter.length ? ' for these teams' : ''}.</div>}
      {teams.map((t) => (
        <div key={t.team.id}>
          <h2 className="section-title team-title">
            <Logo src={t.team.logo} size={24} alt="" />
            <Link to={`/teams/${t.team.abbreviation}?tab=injuries`}>{t.team.name}</Link>
            <span className="muted small">({t.injuries.length})</span>
          </h2>
          <div className="card table-card"><InjuryTable injuries={t.injuries} /></div>
        </div>
      ))}
      <SourceNote week={d.practice_report_week} />
      <Updated at={d.last_updated} />
    </section>
  );
}
