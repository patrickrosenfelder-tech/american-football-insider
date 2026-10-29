import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api.js';
import { ErrorBox, Logo, PageSkeleton } from '../components.jsx';
import { formatDateTime, formatKickoff } from '../dates.js';

const GROUP_LABELS = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', OL: 'OL', DL: 'DL', LB: 'LB', CB: 'CB', S: 'S', K: 'K' };
const signed = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${Math.round(x)}`);

function Trend({ history }) {
  if (!history || history.length < 2) return <span className="muted small">—</span>;
  const values = history.map((h) => h.base_elo);
  const lo = Math.min(...values); const hi = Math.max(...values); const span = Math.max(hi - lo, 1);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 80},${22 - ((v - lo) / span) * 20}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className="elo-trend" width="80" height="24" viewBox="0 0 80 24" role="img" aria-label={`Base Elo from ${values[0]} to ${values[values.length - 1]} this season`}>
      <polyline points={points} fill="none" stroke={up ? 'var(--good, #1a7f4b)' : 'var(--bad, #b42318)'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function Elo() {
  const { data, loading, error } = useApi('/elo');
  const teams = useApi('/teams');
  const [open, setOpen] = useState(null);
  const meta = useMemo(() => Object.fromEntries((teams.data?.data || []).map((t) => [t.abbreviation, t])), [teams.data]);
  if (loading) return <PageSkeleton label="Loading Elo ratings…" tables={1} rows={10} />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  const topGroup = (groups) => Object.entries(groups).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return (
    <section className="page">
      <div className="page-head"><div>
        <h1>AFI Elo ratings</h1>
        <p className="muted">Week {d.week}, {d.season}. <b>Base Elo</b> = results Elo (moves with every final score) + roster adjustment (this week’s available players by position group, compared with the league average). 1500 is average; 25 Elo ≈ 1 point of spread.</p>
      </div></div>
      <div className="card table-wrap"><table className="elo-table">
        <thead><tr><th>Rank</th><th className="left">Team</th><th>Record</th><th>Results Elo</th><th>Roster</th><th>Base Elo</th><th className="left">Biggest roster factor</th><th>Season</th></tr></thead>
        <tbody>{d.teams.map((t) => {
          const m = meta[t.team_espn] || {};
          const [g, v] = topGroup(t.groups);
          return [
            <tr key={t.team}>
              <td>{t.rank}</td>
              <td className="left nowrap"><Link to={`/teams/${t.team_espn}`}>{m.logo && <Logo src={m.logo} size={22} alt="" />} <b>{t.team_espn}</b></Link></td>
              <td>{m.record || '—'}</td>
              <td>{t.results_elo}</td>
              <td className={t.roster_adj >= 0 ? 'pos' : 'neg'}>{signed(t.roster_adj)}</td>
              <td><b>{t.base_elo}</b></td>
              <td className="left small"><button type="button" className="link-button" aria-expanded={open === t.team} onClick={() => setOpen(open === t.team ? null : t.team)}>{GROUP_LABELS[g]} {signed(v)} · all groups</button></td>
              <td><Trend history={t.history} /></td>
            </tr>,
            open === t.team && (
              <tr key={`${t.team}-groups`} className="elo-groups-row"><td colSpan="8">
                <div className="elo-groups">{Object.entries(t.groups).map(([k, x]) => <span key={k} className={`elo-chip ${x >= 0 ? 'pos' : 'neg'}`}>{GROUP_LABELS[k]} {signed(x)}</span>)}</div>
              </td></tr>
            )
          ];
        })}</tbody>
      </table></div>

      {d.games?.length > 0 && <>
        <h2>This week by base Elo</h2>
        <div className="card table-wrap"><table>
          <thead><tr><th className="left">Matchup</th><th className="left">Kickoff</th><th>Away Elo</th><th>Home Elo</th><th>AFI v3 home win</th></tr></thead>
          <tbody>{d.games.map((g) => (
            <tr key={g.game_id}>
              <td className="left nowrap">{g.away} @ {g.home}</td><td className="left small">{formatKickoff(g.kickoff)}</td>
              <td>{g.away_base_elo ?? '—'}</td><td>{g.home_base_elo ?? '—'}</td><td>{Math.round(g.v3_home_win_prob * 100)}%</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="muted small">The win chance comes from the full AFI v3 model (Elo, roster, matchups, QB style), not from base Elo alone, so the two can disagree slightly. AFI Picks still use the current live model.</p>
      </>}

      <h2>How much each position group is worth</h2>
      <p className="muted small">Elo swing when a team’s position group is one standard deviation better than average, learned from every game since 2016.</p>
      <div className="elo-groups">{Object.entries(d.position_factors_elo_per_sd || {}).sort((a, b) => b[1] - a[1]).map(([k, x]) => <span key={k} className="elo-chip">{GROUP_LABELS[k]} {signed(x)}</span>)}</div>
      <p className="muted small">Model {d.model_version} · updated {formatDateTime(d.generated_at)} · <Link to="/accuracy"><u>How accurate is it?</u></Link></p>
    </section>
  );
}
