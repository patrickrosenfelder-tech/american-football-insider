import { useApi } from '../api.js';
export default function PowerRankings() {
  const { data, loading, error } = useApi('/power-rankings');
  if (loading) return <div className="state">Loading power rankings…</div>;
  if (error) return <div className="state error">{error.message}</div>;
  const d = data.data;
  return <section className="page"><h1>AFI Power Rankings</h1><p className="muted">{d.methodology}</p>
    <div className="card table-wrap"><table><thead><tr><th>Rank</th><th>Team</th><th>Score</th><th>Elo</th><th>Why</th></tr></thead>
      <tbody>{d.rankings.map(r => <tr key={r.team}><td>{r.rank}</td><td><b>{r.team}</b></td><td>{r.score}</td><td>{r.elo}</td><td>{r.reason}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
