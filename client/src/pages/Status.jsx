import { useApi, formatTimestamp } from '../api.js';
import { Loading, ErrorBox } from '../components.jsx';

const when = formatTimestamp;

// Data-status view over /api/status: one row per source, plus the model predictions artifact.
export default function Status() {
  const { data, error, loading } = useApi('/status');
  if (loading) return <Loading label="Loading data status…" />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  return <section className="page"><h1>Data status</h1>
    <p className="muted small">Last success means a complete refresh. Degraded means some data failed to refresh; cached results may be older. Earlier errors are labeled with their time.</p>
    <div className="card table-wrap"><table><thead><tr><th className="left">Source</th><th className="left">Provider</th><th>State</th><th>Last success</th><th>Last attempt</th><th>Next run</th><th className="left">Details</th></tr></thead>
      <tbody>{d.sources.map((s) => <tr key={s.source}>
        <td className="left"><b>{s.label}</b></td><td className="left small">{s.provider}</td><td>{s.state}</td><td className="small">{when(s.last_success)}</td><td className="small">{when(s.last_run)}</td><td className="small">{when(s.next_run)}</td>
        <td className="left small">{s.source === 'model_predictions' ? `Generated ${when(s.generated_at)} · ${s.games} games${s.stale ? ' · STALE' : ''}` : ''}{s.last_error ? <span className="muted"> {s.last_attempt_error || s.state === 'error' ? 'Latest attempt: ' : 'Earlier error: '}{s.last_error} {s.last_error_at ? `(${when(s.last_error_at)})` : ''}</span> : ''}</td>
      </tr>)}</tbody></table></div>
    <p className="muted small">Server time {when(d.server_time)}.</p>
  </section>;
}
