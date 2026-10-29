import { Link } from 'react-router-dom';
import { useApi } from '../api.js';
import { ErrorBox, PageSkeleton } from '../components.jsx';
import { formatDate } from '../dates.js';

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);

export default function Accuracy() {
  const { data, loading, error } = useApi('/model/accuracy');
  if (loading) return <PageSkeleton label="Loading accuracy…" tables={2} rows={5} />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  const seasons = d.seasons?.length ? `${d.seasons[0]}–${d.seasons[d.seasons.length - 1]}` : '';
  const bucketKeys = Object.keys(d.confidence_buckets || {});
  const ranges = d.confidence_buckets?.[bucketKeys[0]]?.map((b) => b.range) || [];
  const live = d.live?.record;
  return (
    <section className="page">
      <div className="page-head"><div>
        <h1>Accuracy vs Vegas</h1>
        <p className="muted">Every game {seasons} predicted week by week, using only information available before that week (walk-forward backtest, {d.games.toLocaleString('en-US')} games). Compared with the Vegas closing line on the same games.</p>
      </div></div>

      <div className="card table-wrap"><table>
        <thead><tr><th className="left">Model</th><th>Winners picked</th><th>Log loss</th><th>Avg. margin error</th><th>Against the spread</th></tr></thead>
        <tbody>{d.models.map((m) => (
          <tr key={m.key} className={m.key === 'vegas' ? 'muted-row' : ''}>
            <td className="left"><b>{m.label}</b></td><td>{pct(m.su_accuracy)}</td><td>{m.log_loss.toFixed(4)}</td>
            <td>{m.margin_mae.toFixed(2)} pts</td><td>{m.ats ? `${m.ats.pct.toFixed(1)}% (${m.ats.w}-${m.ats.l}-${m.ats.p})` : '—'}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="muted small">Log loss rewards confident correct picks and punishes confident wrong ones; lower is better and 0.693 is a coin flip. Breaking even against the spread at standard −110 odds needs 52.4%.</p>

      {ranges.length > 0 && <>
        <h2>Accuracy by confidence</h2>
        <p className="muted small">Winners picked, grouped by how many points the model favors one side. Most NFL games are close, which is why no model gets near 75% overall, but confident picks do.</p>
        <div className="card table-wrap"><table>
          <thead><tr><th className="left">Model</th>{ranges.map((r) => <th key={r}>{r} pts</th>)}</tr></thead>
          <tbody>{bucketKeys.map((k) => (
            <tr key={k}><td className="left"><b>{d.labels[k]}</b></td>
              {d.confidence_buckets[k].map((b) => <td key={b.range}>{pct(b.su_accuracy)}<span className="muted small"> · {b.games}</span></td>)}
            </tr>
          ))}</tbody>
        </table></div>
      </>}

      {live && <>
        <h2>Live AFI Picks record</h2>
        <div className="card"><p>Graded against the line at pick time{d.live.tracking_since ? ` since ${formatDate(d.live.tracking_since)}` : ''}: <b>spread {live.spread?.text}</b> ({live.spread?.pct ?? '—'}%), <b>moneyline {live.moneyline?.text}</b>, <b>totals {live.total?.text}</b>. <Link to="/picks"><u>See this week’s picks</u></Link></p></div>
      </>}
      <p className="muted small">Backtest generated {formatDate(d.generated_at)}. For entertainment only, not betting advice.</p>
    </section>
  );
}
