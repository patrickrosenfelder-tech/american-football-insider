import { useApi } from '../api.js';

export default function Model() {
  const { data, loading, error } = useApi('/model');
  if (loading) return <div className="state">Loading AFI Model…</div>;
  if (error) return <div className="state error">{error.message}</div>;
  const m = data.data;
  const v2 = m.metrics.overall; const v1 = m.metrics.baselines.afi_v1_recency; const market = m.metrics.baselines.closing_line;
  return <section className="page"><h1>AFI Model</h1>
    <p className="muted">Our transparent, point-in-time prediction model combines team efficiency, tendency and matchup signals. {m.disclaimer}</p>
    <div className="card"><h2>{m.version} · {m.algorithm}</h2>
      <p><b>Promotion:</b> {m.promotion_rule}</p>
      <h3>Out-of-sample comparison</h3>
      <p className="muted small">V2: {(v2.su_accuracy * 100).toFixed(2)}% SU · {v2.log_loss} log loss. V1: {(v1.su_accuracy * 100).toFixed(2)}% SU · {v1.log_loss} log loss. Closing line: {(market.su_accuracy * 100).toFixed(1)}% SU · {market.log_loss} log loss.</p>
      <p className="muted small">V2 improves on V1, but it does not outperform the closing line yet.</p>
      <h3>Feature groups</h3><p>{m.feature_groups.join(' · ')}</p>
    </div>
  </section>;
}
