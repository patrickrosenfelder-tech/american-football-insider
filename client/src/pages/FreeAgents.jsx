import { useState } from 'react';
import { useApi } from '../api.js';
import { Loading, ErrorBox } from '../components.jsx';

function Rows({ list }) {
  return <div className="card table-card"><table><thead><tr><th>Rank</th><th className="left">Player</th><th>Pos</th><th>Age</th><th>Last team</th><th className="left">2025 / 2026 key stats</th><th>Status</th><th>Team fits</th><th>AFI score</th></tr></thead>
    <tbody>{list.map((p, i) => <tr key={p.id}><td>{i + 1}</td><td className="left nowrap">{p.headshot && <img className="headshot mini" src={p.headshot} alt="" loading="lazy" />}<b>{p.name}</b></td><td>{p.position}</td><td>{p.age ?? '—'}</td><td>{p.last_team || '—'}</td>
      <td className="left small">{p.key_stats?.[2025] && <div><b>2025:</b> {p.key_stats[2025]}</div>}{p.key_stats?.[2026] && <div><b>2026:</b> {p.key_stats[2026]}</div>}{!p.key_stats?.[2025] && !p.key_stats?.[2026] && <span className="muted">No NFL snaps 2025-26</span>}</td>
      <td className="small">{p.status}</td><td className="small">{p.team_fits?.length ? p.team_fits.map((f) => f.team).join(', ') : '—'}</td><td><b>{p.score.toFixed(1)}</b></td></tr>)}</tbody></table></div>;
}

export default function FreeAgents() {
  const { data, loading, error } = useApi('/free-agents');
  const [ps, setPs] = useState(false);
  if (loading) return <Loading label="Loading free agents…" />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  return <section className="page"><h1>Top Free Agents</h1>
    <p className="muted">Unsigned veterans and active-roster releases, each confirmed as a free agent on ESPN at the last daily refresh{d.last_updated ? ` (${new Date(d.last_updated).toLocaleString()})` : ''}. Players who sign anywhere drop off automatically.</p>
    <div className="card prose note"><b>How the AFI FA score works</b><br />{d.formula}<br /><span className="small muted">Team fits = top 3 teams by positional need: healthy players vs. a 53-man target at the position, plus injured starters (nflverse weekly rosters + 2026 snap shares).</span></div>
    <Rows list={d.agents} />
    {!d.agents.length && <div className="state">No confirmed free agents in the latest refresh.</div>}
    {d.recently_signed?.length > 0 && <><h2 className="section-title">Recently signed (last 14 days)</h2><div className="card list-card">{d.recently_signed.map((s) => <div className="news" key={`${s.name}-${s.signed_date}`}>{s.headshot && <img className="headshot mini" src={s.headshot} alt="" loading="lazy" />}<b>{s.name}</b> {s.position} → <b>{s.new_team}</b> <span className="muted">· {s.signed_date}</span></div>)}</div></>}
    {d.practice_squad?.length > 0 && <><h2 className="section-title">Practice-squad releases <button className="link-btn" onClick={() => setPs(!ps)}>{ps ? 'hide' : `show ${d.practice_squad.length}`}</button></h2>{ps && <Rows list={d.practice_squad} />}</>}
  </section>;
}
