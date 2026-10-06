import { Link, useSearchParams } from 'react-router-dom';
import { useApi, formatKickoff } from '../api.js';
import { Loading, ErrorBox, Logo, Updated } from '../components.jsx';

const fmtLine = (v) => (v == null ? '–' : v > 0 ? `+${v}` : v === 0 ? 'PK' : `${v}`);
const fmtMl = (v) => (v == null ? '' : v > 0 ? ` (+${v})` : ` (${v})`);

function Result({ r }) {
  if (!r) return null;
  return <span className={`pick-res ${r === 'W' ? 'win' : r === 'L' ? 'loss' : 'push'}`}>{r === 'W' ? 'Win' : r === 'L' ? 'Loss' : 'Push'}</span>;
}

function PickCard({ g }) {
  const p = g.pick;
  return (
    <div className="card pick-card">
      <div className="game-card-head">
        <span className={`pill ${g.state === 'pre' ? 'pre' : g.state === 'in' ? 'live' : 'final'}`}>{g.state === 'pre' ? formatKickoff(g.date) : g.detail}</span>
        {p?.locked_at && <span className="muted small">Locked at kickoff</span>}
      </div>
      <Link to={`/preview/${g.game_id}`} className="wx-teams">
        <Logo src={g.away.logo} size={26} /><b>{g.away.abbreviation}</b>{g.state !== 'pre' && <span className="tabnum">{g.away.score}</span>}
        <span className="muted">@</span>
        <Logo src={g.home.logo} size={26} /><b>{g.home.abbreviation}</b>{g.state !== 'pre' && <span className="tabnum">{g.home.score}</span>}
      </Link>
      {!p && <p className="muted small">No pick (game started before tracking or no line posted).</p>}
      {p && (
        <>
          <div className="afi-signals">
            <span className="confidence-stars" title={`${p.confidence_edge} point model-to-market edge`}>{'★'.repeat(p.confidence_stars)}<em> AFI Confidence Rating</em></span>
            <span className={`momentum ${p.momentum?.home?.label?.toLowerCase()}`}>{p.momentum?.home?.badge} {g.home.abbreviation} {p.momentum?.home?.label}</span>
            <span className={`momentum ${p.momentum?.away?.label?.toLowerCase()}`}>{p.momentum?.away?.badge} {g.away.abbreviation} {p.momentum?.away?.label}</span>
          </div>
          <div className="pick-lines">
            <div>
              <span className="muted small">Spread</span>
              <b>{p.spread ? `${p.spread.team} ${fmtLine(p.spread.line)}` : '–'}</b>
              {p.spread && <span className={`conf ${p.spread.confidence}`}>{p.spread.confidence}</span>}
              <Result r={p.result?.spread} />
            </div>
            <div>
              <span className="muted small">Total</span>
              <b>{p.total ? `${p.total.side === 'over' ? 'Over' : 'Under'} ${p.total.line}` : '–'}</b>
              {p.total && <span className={`conf ${p.total.confidence}`}>{p.total.confidence}</span>}
              <Result r={p.result?.total} />
            </div>
            <div>
              <span className="muted small">Moneyline</span>
              <b>{p.moneyline.team}{fmtMl(p.moneyline.odds)}</b>
              <span className="muted small">{p.moneyline.model_prob}% model{p.moneyline.implied_prob != null ? ` / ${p.moneyline.implied_prob}% implied` : ''}</span>
              <Result r={p.result?.moneyline} />
            </div>
          </div>
          <p className="small">{p.reasoning}</p>
          <p className="key-stat"><b>Efficiency signal:</b> {p.efficiency_rating?.snippet}</p>
          <div className="afi-edges"><b>AFI Key Matchups</b>{p.micro_matchups?.map((m) => <span key={`${m.label}-${m.text}`} className="afi-edge">{m.icon} <b>{m.label}:</b> {m.text}</span>) || <span className="muted small">Limited data</span>}</div>
          <p className="muted small">Model: {p.home} {fmtLine(p.model.spread_home)}, total {p.model.total} · Market: {p.market.details || '–'}{p.market.total != null ? `, O/U ${p.market.total}` : ''}</p>
        </>
      )}
    </div>
  );
}

function RecordTiles({ record }) {
  return (
    <div className="grid record-grid">
      {[['spread', 'Against the spread'], ['total', 'Totals (O/U)'], ['moneyline', 'Moneyline']].map(([k, label]) => (
        <div key={k} className="card record-tile">
          <span className="muted small">{label}</span>
          <span className="record-big">{record[k].text}</span>
          <span className="muted small">{record[k].pct != null ? `${record[k].pct}%` : 'No graded picks yet'}</span>
        </div>
      ))}
    </div>
  );
}

function ConfidenceRecord({ rows }) {
  return <div className="card table-card"><table><thead><tr><th className="left">AFI Confidence Rating</th><th>ATS</th><th>O/U</th><th>ML</th></tr></thead><tbody>
    {rows.map((row) => <tr key={row.stars}><td className="left"><span className="confidence-stars">{'★'.repeat(row.stars)}</span></td><td>{row.spread.text}</td><td>{row.total.text}</td><td>{row.moneyline.text}</td></tr>)}
  </tbody></table></div>;
}

export default function Picks() {
  const [params] = useSearchParams();
  const week = params.get('week');
  const { data, error, loading } = useApi(`/picks${week ? `?week=${week}` : ''}`);
  if (loading) return <Loading label="Running the model…" />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>AFI Picks · Week {d.week}</h1>
          <p className="muted small">Our model’s spread, total and moneyline pick for every game, with a transparent season record.</p>
        </div>
        <div className="tabs">
          {d.week > 1 && <Link className="btn" to={`/picks?week=${d.week - 1}`}>← Week {d.week - 1}</Link>}
          <Link className="btn" to={`/picks?week=${d.week + 1}`}>Week {d.week + 1} →</Link>
        </div>
      </div>
      <p className="disclaimer">{d.disclaimer}</p>
      <h2 className="section-title">Season record{d.tracking_since ? <span className="muted small"> · tracked since {new Date(d.tracking_since).toLocaleDateString()}</span> : ''}</h2>
      <RecordTiles record={d.record} />
      <h2 className="section-title">Record by confidence</h2>
      <ConfidenceRecord rows={d.confidence_record} />
      <h2 className="section-title">Week {d.week} picks</h2>
      <div className="grid wx-cards">
        {d.games.map((g) => <PickCard key={g.game_id} g={g} />)}
      </div>
      {d.weekly.length > 0 && (
        <>
          <h2 className="section-title">By week</h2>
          <div className="card table-card">
            <table>
              <thead><tr><th className="left">Week</th><th>ATS</th><th>O/U</th><th>ML</th></tr></thead>
              <tbody>{d.weekly.map((w) => <tr key={w.week}><td className="left">Week {w.week}</td><td>{w.spread.text}</td><td>{w.total.text}</td><td>{w.moneyline.text}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <h2 className="section-title">How AFI makes picks</h2>
      <p className="muted small note">{d.method}</p>
      <Updated at={d.last_updated} />
    </section>
  );
}

function TrendCol({ t }) {
  const c = t.current;
  const rows = [
    ['Straight up', c.su.text], ['ATS', c.ats.text], ['O/U', `${c.ou.w}-${c.ou.l}${c.ou.p ? `-${c.ou.p}` : ''}`],
    ['ATS home / away', `${c.home.ats.text} / ${c.away.ats.text}`], ['ATS fav. / dog', `${c.favorite.ats.text} / ${c.underdog.ats.text}`],
    ['Last 5 ATS', c.last5.ats.text], ['Last 5 O/U', c.last5.ou.text], ['Avg. margin', c.avg_margin ?? '–'], ['Avg. total', c.avg_total ?? '–'],
    [`${t.previous.season} ATS / O/U`, `${t.previous.ats.text} / ${t.previous.ou.text}`]
  ];
  return rows;
}

// Matchup betting trends block (preview page): both teams' ATS / O-U splits, key trends and the AFI pick.
export function TrendsBlock({ gameId, away, home }) {
  const trends = useApi(`/trends/game/${gameId}`);
  const picks = useApi('/picks');
  if (trends.loading) return <div className="card"><Loading label="Loading trends…" /></div>;
  if (trends.error) return null;
  const { away: ta, home: th } = trends.data.data;
  const ra = TrendCol({ t: ta });
  const rh = TrendCol({ t: th });
  const pick = picks.data?.data.games.find((g) => g.game_id === gameId)?.pick;
  return (
    <div className="grid two-col">
      <div className="card">
        <h3 className="card-title compare-head"><span>{away.abbreviation}</span><span>Betting trends {ta.season}</span><span>{home.abbreviation}</span></h3>
        {ra.map(([label, a], i) => (
          <div key={label} className="compare-row"><b>{a}</b><span className="muted">{label}</span><b>{rh[i][1]}</b></div>
        ))}
        <p className="muted small note">Closing lines from nflverse schedules. ATS = against the spread.</p>
      </div>
      <div className="card">
        <h3 className="card-title">Key trends</h3>
        <ul className="trend-list">
          {[...ta.key_trends.slice(0, 3), ...th.key_trends.slice(0, 3)].map((x) => <li key={x}>{x}</li>)}
        </ul>
        {pick && (
          <>
            <h3 className="card-title mt">AFI pick</h3>
            <p className="small">
              <b>{pick.spread ? `${pick.spread.team} ${fmtLine(pick.spread.line)}` : ''}</b>
              {pick.total ? <> · <b>{pick.total.side === 'over' ? 'Over' : 'Under'} {pick.total.line}</b></> : null}
              {' · '}<b>{pick.moneyline.team} ML</b>
            </p>
            <p className="small">{pick.reasoning}</p>
            <p className="muted small"><Link to="/picks"><u>All AFI Picks & record →</u></Link> For entertainment only — not betting advice.</p>
          </>
        )}
      </div>
    </div>
  );
}
