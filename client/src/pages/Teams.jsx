import { Link } from 'react-router-dom';
import { useApi } from '../api.js';
import { Loading, ErrorBox, Logo, Updated } from '../components.jsx';

export default function Teams() {
  const { data, error, loading } = useApi('/teams');
  if (loading) return <Loading label="Loading teams…" />;
  if (error) return <ErrorBox error={error} />;

  const byDivision = data.data.reduce((acc, t) => {
    (acc[t.division || 'Other'] ||= []).push(t);
    return acc;
  }, {});
  const divisions = Object.keys(byDivision).sort();

  return (
    <section>
      <div className="page-head"><h1>Teams</h1></div>
      <div className="grid div-grid">
        {divisions.map((div) => (
          <div key={div} className="card">
            <h2 className="card-title">{div}</h2>
            {byDivision[div].map((t) => (
              <Link key={t.id} to={`/teams/${t.abbreviation}`} className="team-link" style={{ '--team': t.color }}>
                <Logo src={t.logo} size={32} alt="" />
                <span className="grow">{t.name}</span>
                <span className="muted">{t.record}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
      <Updated at={data.last_updated} />
    </section>
  );
}
