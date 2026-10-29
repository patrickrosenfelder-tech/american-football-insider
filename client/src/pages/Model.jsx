import { Link } from 'react-router-dom';
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
    <div className="card"><h2>AFI v3 (Elo ratings and matchup win chances)</h2>
      <p><b>Player grades:</b> every player’s production per snap from play-by-play (EPA for QB/RB/WR/TE, pressure and ball production for defenders, protection for the offensive line), plus PFR coverage, hurries and missed tackles for defenders. Recent games count more, and players with few snaps stay close to backup level.</p>
      <p><b>Base Elo:</b> results Elo, which moves with every final score, plus a roster adjustment from this week’s available players by position group. A missing starter is replaced by his backup’s grade, so a QB injury costs exactly the starter-to-backup gap.</p>
      <p><b>Matchup layer:</b> efficiency and pressure matchups and QB style (time to throw, aggressiveness). Each factor was kept only after beating 1,000 shuffled copies of itself in a week-by-week backtest.</p>
      <p><Link to="/elo"><u>Elo ratings</u></Link> · <Link to="/accuracy"><u>Accuracy vs Vegas</u></Link></p>
    </div>
  </section>;
}
