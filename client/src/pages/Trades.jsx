import { useApi } from '../api.js';
import { Loading, ErrorBox } from '../components.jsx';

function TradeCard({ trade }) {
  return <article className="card trade-card"><div className="trade-head"><div><b>{new Date(`${trade.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</b><span className="muted"> · {trade.status}</span></div><span className="pill final">Completed</span></div>
    <div className="trade-sides">{trade.teams.map((side) => <div key={side.team}><b>{side.team}</b><p className="muted">Gave</p><TradeItems items={side.gives} /><p className="muted">Received</p><TradeItems items={side.receives} /></div>)}</div></article>;
}
function TradeItems({ items = [] }) { return <ul>{items.length ? items.map((item, i) => item.type === 'pick' ? <li key={i}>{item.label}</li> : <li className="trade-player" key={i}>{item.headshot && <img className="headshot" src={item.headshot} alt="" />}<span><b>{item.name}</b> {item.position || '—'}{item.age ? ` · ${item.age}` : ''}<small>{item.snap_share} · {item.key_stats}</small></span></li>) : <li>Considerations</li>}</ul>; }

export default function Trades() {
  const trades = useApi('/trades'); const rumors = useApi('/trades/rumors');
  if (trades.loading || rumors.loading) return <Loading label="Loading trades…" />;
  if (trades.error) return <ErrorBox error={trades.error} />;
  const t = trades.data.data; const r = rumors.data?.data?.rumors || [];
  const deadline = t.deadline && new Date(t.deadline); const days = deadline ? Math.ceil((deadline - Date.now()) / 864e5) : null;
  return <section className="page"><div className="page-head"><div><h1>Latest Trades</h1><p className="muted">Completed NFL trades merged from nflverse’s ledger and ESPN transactions.</p></div>{deadline && <div className="card small"><b>2026 trade deadline</b><br />{deadline.toLocaleString()} · {days > 0 ? `${days} days away` : 'Passed'}<br /><span className="muted">{t.deadline_source}</span></div>}</div>
    <div className="trade-grid">{t.trades.map((trade) => <TradeCard trade={trade} key={trade.id} />)}{!t.trades.length && <div className="state">No trades recorded for the selected season.</div>}</div>
    <h2 className="section-title" id="rumors">Trade rumors</h2><p className="muted">Signals from the AFI news feed. Linked articles remain at their original publishers.</p>
    <div className="trade-grid">{r.map((x) => <article className="card" key={x.id}><div className="trade-head"><b>{x.title}</b><span className={`pill ${x.status === 'Cold' ? 'final' : 'pre'}`}>{x.status}</span></div><p>{x.summary}</p><p className="small muted">First seen {new Date(x.first_seen).toLocaleDateString()} · {x.mentions} outlet{x.mentions === 1 ? '' : 's'}</p><div className="sources">{x.sources.slice(0, 4).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer">{s.name || 'Source'}</a>)}</div></article>)}{!r.length && <div className="card muted">No active rumors in the current news window.</div>}</div>
  </section>;
}
