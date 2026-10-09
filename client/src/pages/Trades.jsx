import { useApi } from '../api.js';
import { Loading, ErrorBox } from '../components.jsx';

function TradeCard({ trade }) {
  return <article className="card trade-card"><div className="trade-head"><div><b>{new Date(`${trade.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</b><span className="muted"> · {trade.status}</span></div><span className="pill final">Completed</span></div>
    <div className="trade-sides">{trade.teams.map((side) => <div key={side.team}><b>{side.team}</b><p className="muted">Received</p><ul>{side.receives.length ? side.receives.map((item, i) => <li key={i}>{item}</li>) : <li>Considerations</li>}</ul><p className="small muted">AFI impact: player 2026 snap share and key stats populate as player data refreshes.</p></div>)}</div></article>;
}

export default function Trades() {
  const trades = useApi('/trades'); const rumors = useApi('/trades/rumors');
  if (trades.loading || rumors.loading) return <Loading label="Loading trades…" />;
  if (trades.error) return <ErrorBox error={trades.error} />;
  const t = trades.data.data; const r = rumors.data?.data?.rumors || [];
  return <section className="page"><div className="page-head"><div><h1>Latest Trades</h1><p className="muted">Completed NFL trades from nflverse’s transaction ledger.</p></div></div>
    <div className="trade-grid">{t.trades.map((trade) => <TradeCard trade={trade} key={trade.id} />)}{!t.trades.length && <div className="state">No trades recorded for the selected season.</div>}</div>
    <h2 className="section-title" id="rumors">Trade rumors</h2><p className="muted">Signals from the AFI news feed. Linked articles remain at their original publishers.</p>
    <div className="trade-grid">{r.map((x) => <article className="card" key={x.id}><div className="trade-head"><b>{x.title}</b><span className={`pill ${x.status === 'Cold' ? 'final' : 'pre'}`}>{x.status}</span></div><p>{x.summary}</p><p className="small muted">First seen {new Date(x.first_seen).toLocaleDateString()} · {x.mentions} outlet{x.mentions === 1 ? '' : 's'}</p><div className="sources">{x.sources.slice(0, 4).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.name || 'Source'}</a>)}</div></article>)}{!r.length && <div className="card muted">No active rumors in the current news window.</div>}</div>
  </section>;
}
