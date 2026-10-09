import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api.js';

const COLS = [
  { id: 'rank', label: 'Rank', key: (r) => r.rank, desc: false },
  { id: 'team', label: 'Team', key: (r) => r.team, desc: false, left: true },
  { id: 'record', label: 'Record', key: (r) => winPct(r.record), desc: true },
  { id: 'score', label: 'Score', key: (r) => r.score, desc: true },
  { id: 'elo', label: 'Elo', key: (r) => r.elo, desc: true },
  { id: 'off', label: 'Off EPA', key: (r) => r.off_adj_epa_proxy ?? -99, desc: true },
  { id: 'def', label: 'Def EPA', key: (r) => r.def_adj_epa_proxy ?? -99, desc: true },
];

function winPct(rec) {
  const [w = 0, l = 0, t = 0] = String(rec || '').split('-').map(Number);
  const g = w + l + t;
  return g ? (w + t / 2) / g : -1;
}

const fmt = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(2));

export default function PowerRankings() {
  const { data, loading, error } = useApi('/power-rankings');
  const teams = useApi('/teams');
  const [view, setView] = useState({ sort: 'rank', dir: 'asc', conf: '', div: '' });
  const meta = useMemo(() => Object.fromEntries((teams.data?.data || []).map((t) => [t.abbreviation, t])), [teams.data]);
  const rows = useMemo(() => {
    const list = (data?.data.rankings || []).map((r) => ({ ...r, record: meta[r.team]?.record, conference: meta[r.team]?.conference, division: meta[r.team]?.division, name: meta[r.team]?.name, logo: meta[r.team]?.logo }));
    const col = COLS.find((c) => c.id === view.sort);
    const sign = view.dir === 'desc' ? -1 : 1;
    return list
      .filter((r) => (!view.conf || r.conference === view.conf) && (!view.div || r.division === view.div))
      .sort((a, b) => { const x = col.key(a); const y = col.key(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sign; });
  }, [data, meta, view]);
  if (loading) return <div className="state">Loading power rankings…</div>;
  if (error) return <div className="state error">{error.message}</div>;
  const d = data.data;
  const divisions = [...new Set(Object.values(meta).map((t) => t.division))].filter((x) => x && (!view.conf || x.startsWith(view.conf))).sort();
  const sortBy = (c) => setView((v) => ({ ...v, sort: c.id, dir: v.sort === c.id ? (v.dir === 'desc' ? 'asc' : 'desc') : (c.desc ? 'desc' : 'asc') }));
  return <section className="page"><h1>AFI Power Rankings</h1><p className="muted">{d.methodology}</p>
    <div className="tabs">
      {['', 'AFC', 'NFC'].map((c) => <button key={c || 'all'} type="button" className={view.conf === c ? 'active' : ''} onClick={() => setView((v) => ({ ...v, conf: c, div: '' }))}>{c || 'All'}</button>)}
    </div>
    <div className="filters">
      <label>Division <select value={view.div} onChange={(e) => setView((v) => ({ ...v, div: e.target.value }))}><option value="">All divisions</option>{divisions.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label>Sort <select value={view.sort} onChange={(e) => { const c = COLS.find((x) => x.id === e.target.value); setView((v) => ({ ...v, sort: c.id, dir: c.desc ? 'desc' : 'asc' })); }}>{COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Order <select value={view.dir} onChange={(e) => setView((v) => ({ ...v, dir: e.target.value }))}><option value="asc">Low → high</option><option value="desc">High → low</option></select></label>
    </div>
    <div className="card table-wrap"><table><thead><tr>
      {COLS.map((c) => <th key={c.id} className={`sortable ${view.sort === c.id ? 'active' : ''} ${c.left ? 'left' : ''}`} onClick={() => sortBy(c)}>{c.label}{view.sort === c.id ? (view.dir === 'desc' ? ' ▼' : ' ▲') : ''}</th>)}
      <th className="left">Why</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.team}><td>{r.rank}</td>
        <td className="left nowrap"><Link to={`/teams/${r.team}`}>{r.logo && <img className="headshot mini" src={r.logo} alt="" loading="lazy" />}<b>{r.team}</b></Link></td>
        <td>{r.record || '—'}</td><td>{r.score}</td><td>{r.elo}</td><td>{fmt(r.off_adj_epa_proxy)}</td><td>{fmt(r.def_adj_epa_proxy)}</td><td className="left small">{r.reason}</td></tr>)}</tbody>
    </table>{!rows.length && <div className="state">No teams match these filters.</div>}</div>
    <p className="muted small">Rank is always the overall AFI rank; filters and sorting only change what is shown. Click a column header to sort.</p>
  </section>;
}
