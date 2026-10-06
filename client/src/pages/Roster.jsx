import { Link } from 'react-router-dom';
import { useApi } from '../api.js';
import { Loading, ErrorBox, RatingBadge, InjuryBadge, Updated } from '../components.jsx';

export default function Roster({ teamId }) {
  const { data, error, loading } = useApi(`/teams/${teamId}/roster`);
  if (loading) return <Loading label="Loading roster…" />;
  if (error) return <ErrorBox error={error} />;
  const r = data.data;

  return (
    <div>
      {r.coach && <p className="muted small">Head coach: <b>{r.coach}</b></p>}
      {r.groups.filter((g) => g.count > 0).map((g) => (
        <div key={g.key}>
          <h3 className="section-title">{g.label} <span className="muted small">({g.count})</span></h3>
          <div className="card table-card">
            <table className="roster-table">
              <thead>
                <tr><th className="left">Player</th><th>Pos</th><th>AFI</th><th className="hide-sm">Age</th><th className="hide-sm">Ht / Wt</th><th className="hide-sm">Exp</th><th className="hide-sm left">College</th></tr>
              </thead>
              <tbody>
                {g.positions.flatMap((p) => p.athletes).map((a) => (
                  <tr key={a.id}>
                    <td className="left">
                      <Link to={`/players/${a.id}`} className="player-cell">
                        <img className="headshot sm" src={a.headshot} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                        <span><b>{a.name}</b> <span className="muted small">#{a.jersey ?? '–'}</span></span>
                        <InjuryBadge injury={a.injury} small />
                      </Link>
                    </td>
                    <td>{a.position}</td>
                    <td><RatingBadge rating={a.rating} small /></td>
                    <td className="hide-sm">{a.age ?? '–'}</td>
                    <td className="hide-sm">{a.height || '–'} / {a.weight?.replace(' lbs', '') || '–'}</td>
                    <td className="hide-sm">{a.experience === 0 ? 'R' : a.experience ?? '–'}</td>
                    <td className="hide-sm left">{a.college || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <Updated at={r.last_updated} />
    </div>
  );
}
