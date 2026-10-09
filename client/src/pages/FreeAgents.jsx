import { useApi } from '../api.js';
import { Loading, ErrorBox } from '../components.jsx';
export default function FreeAgents() {
  const { data, loading, error } = useApi('/free-agents');
  if (loading) return <Loading label="Loading free agents…" />; if (error) return <ErrorBox error={error} />;
  const d = data.data;
  return <section className="page"><h1>Top Free Agents</h1><p className="muted">Current released and waived players from ESPN transactions. Signed players are removed at the next daily refresh.</p><div className="card prose note"><b>AFI FA score</b><br />{d.formula}</div>
    <div className="card table-card"><table><thead><tr><th>Rank</th><th className="left">Player</th><th>Pos</th><th>Last team</th><th>Status</th><th>AFI score</th></tr></thead><tbody>{d.agents.map((p, i) => <tr key={p.id}><td>{i + 1}</td><td className="left"><b>{p.name}</b></td><td>{p.position}</td><td>{p.last_team || '—'}</td><td>{p.status}</td><td>{p.score?.toFixed(1)}</td></tr>)}</tbody></table></div>{!d.agents.length && <div className="state">No unsigned players were returned by the latest transaction refresh.</div>}</section>;
}
