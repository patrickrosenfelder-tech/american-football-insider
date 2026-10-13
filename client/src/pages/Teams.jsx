import { Link } from 'react-router-dom';
import { useState } from 'react';
import { getFavoriteTeams, toggleFavoriteTeam, useApi } from '../api.js';
import { Loading, ErrorBox, Logo, Updated } from '../components.jsx';

export default function Teams() {
  const { data, error, loading } = useApi('/teams');
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => getFavoriteTeams());
  if (loading) return <Loading label="Loading teams…" />;
  if (error) return <ErrorBox error={error} />;

  const filtered = data.data.filter((t) => `${t.name} ${t.abbreviation} ${t.division}`.toLowerCase().includes(query.toLowerCase()));
  const byDivision = filtered.reduce((acc, t) => {
    (acc[t.division || 'Other'] ||= []).push(t);
    return acc;
  }, {});
  const divisions = Object.keys(byDivision).sort();

  return (
    <section>
      <div className="page-head teams-head"><div><h1>Teams</h1><p className="muted small">Browse every roster, schedule, injury report, and team feed.</p></div><input className="team-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search teams…" aria-label="Search teams" /></div>
      {favorites.length > 0 && <div className="favorite-strip"><b>My teams</b>{data.data.filter((t) => favorites.includes(t.abbreviation)).map((t) => <Link key={t.id} to={`/teams/${t.abbreviation}`} className="favorite-team"><Logo src={t.logo} size={22} alt="" />{t.abbreviation}</Link>)}</div>}
      <div className="grid div-grid">
        {divisions.map((div) => (
          <div key={div} className="card">
            <h2 className="card-title">{div}</h2>
            {byDivision[div].map((t) => (
              <div key={t.id} className="team-link-row">
                <Link to={`/teams/${t.abbreviation}`} className="team-link" style={{ '--team': t.color }}><Logo src={t.logo} size={32} alt="" /><span className="grow">{t.name}</span><span className="muted">{t.record}</span></Link>
                <button type="button" className={`favorite-button ${favorites.includes(t.abbreviation) ? 'active' : ''}`} aria-label={`${favorites.includes(t.abbreviation) ? 'Remove' : 'Add'} ${t.name} ${favorites.includes(t.abbreviation) ? 'from' : 'to'} favorites`} onClick={() => setFavorites(toggleFavoriteTeam(t.abbreviation))}>{favorites.includes(t.abbreviation) ? '★' : '☆'}</button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Updated at={data.last_updated} />
    </section>
  );
}
