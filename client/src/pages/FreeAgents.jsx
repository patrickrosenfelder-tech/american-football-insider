import { useMemo, useState } from 'react';
import { useApi } from '../api.js';
import { Loading, ErrorBox } from '../components.jsx';

const GROUPS = ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'K', 'P', 'LS'];
const SORTS = {
  score: { label: 'AFI score', key: (p) => p.score ?? -1, desc: true },
  snaps: { label: 'Snaps 2025-26', key: (p) => p.snaps_2025_26 ?? -1, desc: true },
  production: { label: 'Production %', key: (p) => p.production_pct ?? -1, desc: true },
  age: { label: 'Age', key: (p) => p.age ?? 99, desc: false },
  name: { label: 'Name', key: (p) => p.name || '', desc: false },
};

function applyView(list, { group, sort, dir, q, team }) {
  const s = SORTS[sort];
  const needle = q.trim().toLowerCase();
  const out = list.filter((p) => (!group || p.group === group)
    && (!team || p.last_team === team || p.team_fits?.some((f) => f.team === team))
    && (!needle || p.name.toLowerCase().includes(needle)));
  const sign = (dir === 'desc') ? -1 : 1;
  return [...out].sort((a, b) => {
    const x = s.key(a); const y = s.key(b);
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sign;
  });
}

function Th({ id, label, view, setView, className }) {
  if (!id) return <th className={className}>{label}</th>;
  const active = view.sort === id;
  const click = () => setView((v) => ({ ...v, sort: id, dir: active ? (v.dir === 'desc' ? 'asc' : 'desc') : (SORTS[id].desc ? 'desc' : 'asc') }));
  return <th className={`sortable ${active ? 'active' : ''} ${className || ''}`} onClick={click}>{label}{active ? (view.dir === 'desc' ? ' ▼' : ' ▲') : ''}</th>;
}

function Rows({ list, view, setView }) {
  return <div className="card table-card"><table><thead><tr><th>#</th><Th id="name" label="Player" className="left" view={view} setView={setView} /><th>Pos</th><Th id="age" label="Age" view={view} setView={setView} /><th>Last team</th><Th id="snaps" label="2025 / 2026 key stats" className="left" view={view} setView={setView} /><th>Status</th><th>Team fits</th><Th id="score" label="AFI score" view={view} setView={setView} /></tr></thead>
    <tbody>{list.map((p, i) => <tr key={p.id}><td>{i + 1}</td><td className="left nowrap">{p.headshot && <img className="headshot mini" src={p.headshot} alt="" loading="lazy" />}<b>{p.name}</b></td><td>{p.position}</td><td>{p.age ?? '—'}</td><td>{p.last_team || '—'}</td>
      <td className="left small">{p.key_stats?.[2025] && <div><b>2025:</b> {p.key_stats[2025]}</div>}{p.key_stats?.[2026] && <div><b>2026:</b> {p.key_stats[2026]}</div>}{!p.key_stats?.[2025] && !p.key_stats?.[2026] && <span className="muted">No NFL snaps 2025-26</span>}</td>
      <td className="small">{p.status}</td><td className="small">{p.team_fits?.length ? p.team_fits.map((f) => f.team).join(', ') : '—'}</td><td><b>{p.score.toFixed(1)}</b></td></tr>)}</tbody></table>
    {!list.length && <div className="state">No players match these filters.</div>}</div>;
}

export default function FreeAgents() {
  const { data, loading, error } = useApi('/free-agents');
  const [ps, setPs] = useState(false);
  const [view, setView] = useState({ group: '', sort: 'score', dir: 'desc', q: '', team: '' });
  const d = data?.data;
  const all = useMemo(() => [...(d?.agents || []), ...(d?.practice_squad || [])], [d]);
  const groups = GROUPS.filter((g) => all.some((p) => p.group === g));
  const teams = [...new Set(all.flatMap((p) => [p.last_team, ...(p.team_fits || []).map((f) => f.team)]).filter(Boolean))].sort();
  const agents = useMemo(() => applyView(d?.agents || [], view), [d, view]);
  const practice = useMemo(() => applyView(d?.practice_squad || [], view), [d, view]);
  if (loading) return <Loading label="Loading free agents…" />;
  if (error) return <ErrorBox error={error} />;
  const set = (k) => (e) => setView((v) => ({ ...v, [k]: e.target.value }));
  const count = (g) => (d.agents || []).filter((p) => !g || p.group === g).length;
  return <section className="page"><h1>Top Free Agents</h1>
    <p className="muted">Unsigned veterans and active-roster releases, each confirmed as a free agent on ESPN at the last daily refresh{d.last_updated ? ` (${new Date(d.last_updated).toLocaleString()})` : ''}. Players who sign anywhere drop off automatically.</p>
    <div className="card prose note"><b>How the AFI FA score works</b><br />{d.formula}<br /><span className="small muted">Team fits = top 3 teams by positional need: healthy players vs. a 53-man target at the position, plus injured starters (nflverse weekly rosters + 2026 snap shares).</span></div>
    <div className="tabs">
      {['', ...groups].map((g) => <button key={g || 'all'} type="button" className={view.group === g ? 'active' : ''} onClick={() => setView((v) => ({ ...v, group: g }))}>{g || 'All'} <span className="muted small">{count(g)}</span></button>)}
    </div>
    <div className="filters">
      <label>Sort <select value={view.sort} onChange={(e) => setView((v) => ({ ...v, sort: e.target.value, dir: SORTS[e.target.value].desc ? 'desc' : 'asc' }))}>{Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></label>
      <label>Order <select value={view.dir} onChange={set('dir')}><option value="desc">High → low</option><option value="asc">Low → high</option></select></label>
      <label>Team <select value={view.team} onChange={set('team')}><option value="">All (last team or fit)</option>{teams.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label>Search <input type="search" value={view.q} onChange={set('q')} placeholder="Player name" /></label>
    </div>
    <Rows list={agents} view={view} setView={setView} />
    {d.recently_signed?.length > 0 && <><h2 className="section-title">Recently signed (last 14 days)</h2><div className="card list-card">{d.recently_signed.map((s) => <div className="news" key={`${s.name}-${s.signed_date}`}>{s.headshot && <img className="headshot mini" src={s.headshot} alt="" loading="lazy" />}<b>{s.name}</b> {s.position} → <b>{s.new_team}</b> <span className="muted">· {s.signed_date}</span></div>)}</div></>}
    {d.practice_squad?.length > 0 && <><h2 className="section-title">Practice-squad releases <button className="link-btn" onClick={() => setPs(!ps)}>{ps ? 'hide' : `show ${practice.length}`}</button></h2>{ps && <Rows list={practice} view={view} setView={setView} />}</>}
  </section>;
}
