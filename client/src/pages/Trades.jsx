import { useState } from 'react';
import { useApi } from '../api.js';
import { Loading, ErrorBox } from '../components.jsx';

const TEAMS = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WSH'.split(' ');
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OT', 'G', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P'];
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

function Asset({ item }) {
  if (item.type === 'pick') return <li className="trade-pick">{item.label}{item.original_team && <small>Original team: {item.original_team} · AFI value {item.value}</small>}</li>;
  if (item.type !== 'player') return <li>{item.label}</li>;
  return <li className="trade-player">{item.headshot && <img className="headshot" src={item.headshot} alt="" loading="lazy" />}<span><b>{item.name}</b> {item.position || '—'}{item.age ? ` · age ${item.age}` : ''}
    <small>2026 snap share: {item.snap_share_2026 != null ? `${item.snap_share_2026}%` : 'no 2026 snaps'} · AFI value {item.value}</small>
    {item.key_stats && <small>{item.key_stats}</small>}</span></li>;
}

const Assets = ({ items = [] }) => <ul>{items.length ? items.map((item, i) => <Asset item={item} key={i} />) : <li className="muted">Not disclosed</li>}</ul>;

export function TradeCard({ trade }) {
  return <article className="card trade-card"><div className="trade-head"><div><b>{fmtDate(trade.date)}</b><span className="muted"> · {trade.teams.map((s) => s.team).join(' ↔ ')}</span></div><span className="pill final">{trade.status}</span></div>
    <div className="trade-sides">{trade.teams.map((side) => <div key={side.team}><b>{side.team}</b>
      <p className="muted">Gives</p><Assets items={side.gives} />
      <p className="muted">Receives</p><Assets items={side.receives} />
      <p className="small trade-impact"><b>AFI impact</b> {signed(side.impact.net)} <span className="muted">(in {side.impact.value_in} · out {side.impact.value_out})</span></p></div>)}</div>
    <p className="small muted">Source: {trade.sources.join(' + ')}</p></article>;
}

function Deadline({ d }) {
  if (!d) return null;
  return <div className="card small deadline"><b>2026 trade deadline</b><br />{d.label}<br /><span className="big">{d.passed ? 'Passed' : `${d.days_left} day${d.days_left === 1 ? '' : 's'} left`}</span><br /><a href={d.url} target="_blank" rel="noreferrer">Source: {d.source}</a></div>;
}

function Rumor({ x }) {
  return <article className="card rumor"><div className="trade-head"><b>{x.player ? `${x.player.name} (${x.player.position || '—'}, ${x.player.team || 'FA'})` : `${x.teams.join(' / ')} — team trade talk`}</b>
    <span className={`pill ${x.status === 'Active' ? 'pre' : x.status === 'Happened' ? 'live' : 'final'}`}>{x.status}</span></div>
    <p>{x.summary}</p>
    {x.status === 'Happened' && x.trade_id && <p className="small"><a href={`#trade-${x.trade_id}`}>See the completed trade ↑</a></p>}
    <p className="small muted">Teams linked: {x.teams.join(', ') || '—'} · {x.mentions} outlet{x.mentions === 1 ? '' : 's'} · first seen {new Date(x.first_seen).toLocaleDateString()} · updated {new Date(x.last_updated).toLocaleDateString()}</p>
    <div className="sources">{x.sources.slice(0, 5).map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.title}>{s.outlet || 'Source'}</a>)}</div></article>;
}

export default function Trades() {
  const [season, setSeason] = useState('2026');
  const [team, setTeam] = useState('');
  const [position, setPosition] = useState('');
  const q = new URLSearchParams({ season, ...(team && { team }), ...(position && { position }) }).toString();
  const trades = useApi(`/trades?${q}`);
  const rumors = useApi('/trades/rumors');
  const t = trades.data?.data;
  const r = rumors.data?.data?.rumors || [];
  return <section className="page"><div className="page-head"><div><h1>Latest Trades</h1><p className="muted">Completed NFL trades merged from nflverse’s trade ledger and ESPN’s transaction wire, de-duplicated. AFI value = positional value × 2026 snap share × age curve (players) or a round-based chart (picks).</p></div><Deadline d={t?.deadline || rumors.data?.data?.deadline} /></div>
    <div className="filters"><label>Season <select value={season} onChange={(e) => setSeason(e.target.value)}>{['2026', '2025', '2024'].map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Team <select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">All</option>{TEAMS.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label>Position <select value={position} onChange={(e) => setPosition(e.target.value)}><option value="">All</option>{POSITIONS.map((x) => <option key={x}>{x}</option>)}</select></label></div>
    {trades.loading ? <Loading label="Loading trades…" /> : trades.error ? <ErrorBox error={trades.error} />
      : <div className="trade-grid">{t.trades.map((trade) => <div id={`trade-${trade.id}`} key={trade.id}><TradeCard trade={trade} /></div>)}{!t.trades.length && <div className="state">No trades match these filters.</div>}</div>}
    <h2 className="section-title" id="rumors">Trade rumors</h2><p className="muted">Trade talk from ProFootballRumors, Google News and the AFI news feed, grouped by player. Rumors become “Happened” when a matching trade completes and “Cold” after 21 days without a new mention. Articles stay at their publishers.</p>
    {rumors.loading ? <Loading label="Loading rumors…" /> : <div className="trade-grid">{r.map((x) => <Rumor x={x} key={x.id} />)}{!r.length && <div className="card muted">No active rumors right now.</div>}</div>}
  </section>;
}
