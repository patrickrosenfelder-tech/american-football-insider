import { useApi } from '../api.js';

export default function Model() {
  const { data, loading, error } = useApi('/model');
  if (loading) return <div className="state">Loading AFI Model…</div>;
  if (error) return <div className="state error">{error.message}</div>;
  const m = data.data;
  return <section className="page"><h1>AFI Model</h1>
    <p className="muted">Our transparent, point-in-time prediction model combines team efficiency, tendency and matchup signals. {m.disclaimer}</p>
    <div className="card"><h2>{m.version} · {m.algorithm}</h2>
      <p>{m.metrics.note}</p><p><b>Promotion:</b> {m.promotion_rule}</p>
      <h3>Feature groups</h3><p>{m.feature_groups.join(' · ')}</p>
    </div>
  </section>;
}
