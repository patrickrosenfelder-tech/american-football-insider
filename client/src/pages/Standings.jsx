import { Link } from 'react-router-dom';
import { useApi } from '../api.js';
import { Loading, ErrorBox, Logo, Updated } from '../components.jsx';

export default function Standings() {
  const { data, error, loading } = useApi('/standings');
  if (loading) return <Loading label="Loading standings…" />;
  if (error) return <ErrorBox error={error} />;
  const { conferences, season_display } = data.data;

  return (
    <section>
      <div className="page-head"><h1>{season_display} Standings</h1></div>
      <div className="grid conf-grid">
        {conferences.map((conf) => (
          <div key={conf.abbreviation}>
            <h2 className="conf-title">{conf.name}</h2>
            {conf.divisions.map((div) => (
              <div key={div.name} className="card table-card">
                <table className="standings">
                  <thead>
                    <tr>
                      <th className="left">{div.name}</th>
                      <th>W</th><th>L</th><th>T</th><th>PCT</th>
                      <th className="hide-sm">PF</th><th className="hide-sm">PA</th>
                      <th>DIFF</th><th className="hide-sm">STRK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {div.teams.map((t) => (
                      <tr key={t.id}>
                        <td className="left">
                          <Link to={`/teams/${t.abbreviation}`} className="team-cell">
                            <Logo src={t.logo} size={22} alt="" />
                            <span className="full">{t.name}</span>
                            <span className="abbr">{t.abbreviation}</span>
                            {t.playoff_seed && t.playoff_seed <= 7 && <sup className="seed">{t.playoff_seed}</sup>}
                          </Link>
                        </td>
                        <td>{t.wins}</td><td>{t.losses}</td><td>{t.ties}</td><td>{t.win_percent}</td>
                        <td className="hide-sm">{t.points_for}</td><td className="hide-sm">{t.points_against}</td>
                        <td className={t.points_for - t.points_against >= 0 ? 'pos' : 'neg'}>{t.differential}</td>
                        <td className="hide-sm">{t.streak}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="muted small">Superscript = current conference playoff seed.</p>
      <Updated at={data.data.fetched_at} />
    </section>
  );
}
