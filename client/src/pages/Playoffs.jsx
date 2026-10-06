import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, formatKickoff } from '../api.js';
import { Loading, ErrorBox, Logo, Updated } from '../components.jsx';

// Picks are encoded in the URL as 2 bits per regular-season game (season schedule order):
// 0 = no pick, 1 = home, 2 = away, 3 = tie, packed into base64url.
const CODE = { H: 1, A: 2, T: 3 };
const DECODE = [null, 'H', 'A', 'T'];

const encodePicks = (games, picks) => {
  const bytes = new Uint8Array(Math.ceil(games.length / 4));
  games.forEach((g, i) => { bytes[i >> 2] |= (CODE[picks[g.id]] || 0) << ((i & 3) * 2); });
  let last = bytes.length;
  while (last > 0 && bytes[last - 1] === 0) last -= 1;
  if (!last) return '';
  return btoa(String.fromCharCode(...bytes.slice(0, last))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const decodePicks = (games, str) => {
  if (!str) return {};
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const picks = {};
    games.forEach((g, i) => {
      const byte = bin.charCodeAt(i >> 2) || 0;
      const v = DECODE[(byte >> ((i & 3) * 2)) & 3];
      if (v && !g.result) picks[g.id] = v;
    });
    return picks;
  } catch {
    return {};
  }
};

const pctLabel = (v) => (v >= 99.95 ? '>99.9%' : v > 0 && v < 0.1 ? '<0.1%' : `${v.toFixed(1)}%`);

function GamePick({ game, teams, pick, onPick }) {
  const away = teams[game.away];
  const home = teams[game.home];
  const pAway = game.p_home != null ? 1 - game.p_home : null;
  const btn = (side, team, p) => (
    <button type="button" className={`pick-btn ${pick === side ? 'picked' : ''} ${pick && pick !== side ? 'faded' : ''}`}
      onClick={() => onPick(game.id, pick === side ? null : side)} title={`Pick ${team.name}`}>
      <Logo src={team.logo} size={22} />
      <span className="pick-abbr">{team.abbreviation}</span>
      {p != null && <span className="pick-prob">{Math.round(p * 100)}%</span>}
    </button>
  );
  return (
    <div className="pick-row">
      {btn('A', away, pAway)}
      <span className="pick-at">@</span>
      {btn('H', home, game.p_home)}
      <button type="button" className={`pick-tie ${pick === 'T' ? 'picked' : ''}`} onClick={() => onPick(game.id, pick === 'T' ? null : 'T')} title="Tie">T</button>
      <span className="muted small pick-when">{formatKickoff(game.date)}</span>
    </div>
  );
}

function SeedList({ conf, data }) {
  return (
    <div className="card">
      <h3 className="card-title">{conf} seeds</h3>
      {data.seeds.map((t) => (
        <div key={t.id} className="seed-row">
          <span className="seed-num">{t.seed}</span>
          <Logo src={t.logo} size={22} />
          <Link to={`/teams/${t.abbreviation}`} className="grow"><b>{t.name}</b></Link>
          <span className="muted small">{t.division_winner ? 'Div' : 'WC'}</span>
          <span className="tabnum">{t.record}</span>
        </div>
      ))}
      <h3 className="card-title" style={{ marginTop: 14 }}>Wild card round</h3>
      <div className="seed-row"><span className="seed-num">1</span><Logo src={data.bye.logo} size={20} /><span className="grow">{data.bye.abbreviation}</span><span className="muted small">Bye</span></div>
      {data.wild_card_round.map((m) => (
        <div key={m.home.id} className="seed-row">
          <span className="seed-num">{m.away.seed}</span><Logo src={m.away.logo} size={20} /><span>{m.away.abbreviation}</span>
          <span className="muted small">@</span>
          <span className="seed-num">{m.home.seed}</span><Logo src={m.home.logo} size={20} /><span className="grow">{m.home.abbreviation}</span>
        </div>
      ))}
      <p className="muted small">Divisional round re-seeds: the #1 seed hosts the lowest remaining seed.</p>
      {data.hunt.length > 0 && (
        <>
          <h3 className="card-title" style={{ marginTop: 14 }}>In the hunt</h3>
          {data.hunt.slice(0, 4).map((t, i) => (
            <div key={t.id} className="seed-row"><span className="seed-num muted">{8 + i}</span><Logo src={t.logo} size={20} /><span className="grow">{t.abbreviation}</span><span className="tabnum">{t.record}</span></div>
          ))}
        </>
      )}
    </div>
  );
}

function DivisionTables({ divisions }) {
  return (
    <div className="grid div-grid">
      {divisions.map((d) => (
        <div key={d.name} className="card table-card">
          <table>
            <thead><tr><th className="left">{d.name}</th><th>W-L</th><th>Div</th><th>Conf</th><th className="hide-sm" title="Strength of victory">SOV</th></tr></thead>
            <tbody>
              {d.teams.map((t, i) => (
                <tr key={t.id}>
                  <td className="left"><span className="team-cell"><Logo src={t.logo} size={18} />{t.abbreviation}{i === 0 && <sup className="seed">z</sup>}</span></td>
                  <td>{t.record}</td><td>{t.division}</td><td>{t.conference}</td><td className="hide-sm">{t.sov?.toFixed(3) ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function OddsTable({ odds }) {
  const [sort, setSort] = useState('make_playoffs');
  const cols = [['projected_wins', 'Proj. W'], ['make_playoffs', 'Playoffs'], ['win_division', 'Win div.'], ['first_seed', '#1 seed']];
  return (
    <div className="grid conf-grid">
      {['AFC', 'NFC'].map((conf) => (
        <div key={conf}>
          <h2 className="conf-title">{conf}</h2>
          <div className="card table-card">
            <table className="odds-table">
              <thead>
                <tr>
                  <th className="left">Team</th><th>Rec.</th>
                  {cols.map(([k, label]) => <th key={k} className={`sortable ${sort === k ? 'active' : ''}`} onClick={() => setSort(k)}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {odds.teams.filter((t) => t.conf === conf).sort((a, b) => b[sort] - a[sort]).map((t) => (
                  <tr key={t.id}>
                    <td className="left"><Link to={`/teams/${t.abbreviation}`} className="team-cell"><Logo src={t.logo} size={18} /><span className="full">{t.short_name || t.name}</span><span className="abbr">{t.abbreviation}</span></Link></td>
                    <td>{t.record}</td>
                    <td>{t.projected_wins.toFixed(1)}</td>
                    {['make_playoffs', 'win_division', 'first_seed'].map((k) => (
                      <td key={k}><span className="odds-cell" style={{ '--p': `${t[k]}%` }}>{pctLabel(t[k])}</span></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Playoffs() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') || 'picks';
  const { data, error, loading } = useApi('/playoffs');
  const odds = useApi(view === 'odds' ? '/playoffs/odds' : null);
  const [picks, setPicks] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const overview = data?.data;
  const teams = useMemo(() => Object.fromEntries((overview?.teams || []).map((t) => [t.id, t])), [overview]);
  const open = useMemo(() => (overview?.games || []).filter((g) => !g.result), [overview]);

  // Initialise picks from the share URL once the schedule is loaded.
  useEffect(() => {
    if (overview && picks === null) setPicks(decodePicks(overview.games, params.get('p')));
  }, [overview, picks, params]);

  // Keep the URL in sync and recompute standings for the current picks.
  useEffect(() => {
    if (!overview || picks === null) return undefined;
    const code = encodePicks(overview.games, picks);
    const next = new URLSearchParams(params);
    if (code) next.set('p', code); else next.delete('p');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    if (!Object.keys(picks).length) { setResult(null); return undefined; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/playoffs/scenario', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ picks }), signal: ctrl.signal
        });
        const body = await res.json();
        if (body.success) setResult(body.data);
      } catch { /* aborted or offline: keep previous result */ }
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, picks]);

  if (loading) return <Loading label="Loading season schedule…" />;
  if (error) return <ErrorBox error={error} />;

  const setPick = (id, side) => setPicks((p) => {
    const next = { ...p };
    if (side) next[id] = side; else delete next[id];
    return next;
  });
  const pickFavorites = () => setPicks(Object.fromEntries(open.filter((g) => g.p_home != null).map((g) => [g.id, g.p_home >= 0.5 ? 'H' : 'A'])));
  const setView = (v) => { const next = new URLSearchParams(params); next.set('view', v); setParams(next, { replace: true }); };
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const weeks = {};
  open.forEach((g) => { (weeks[g.week] ||= []).push(g); });
  const shown = result || { ...overview.current, picked: 0, unpicked: open.length };
  const pickCount = Object.keys(picks || {}).length;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{overview.season} Playoff Predictor</h1>
          <p className="muted small">Pick the remaining games to see seeds, division winners and the bracket — or check simulated playoff odds.</p>
        </div>
      </div>
      <div className="tabs">
        <button type="button" className={view === 'picks' ? 'active' : ''} onClick={() => setView('picks')}>Make picks</button>
        <button type="button" className={view === 'odds' ? 'active' : ''} onClick={() => setView('odds')}>Playoff odds</button>
      </div>

      {view === 'odds' && (
        <>
          {odds.loading && <Loading label="Simulating the rest of the season…" />}
          {odds.error && <ErrorBox error={odds.error} />}
          {odds.data && (
            <>
              <p className="muted small">{odds.data.data.sims.toLocaleString()} simulations of the {odds.data.data.remaining_games} remaining games. {overview.model.win_probability}</p>
              <OddsTable odds={odds.data.data} />
              <Updated at={odds.data.data.computed_at} />
            </>
          )}
        </>
      )}

      {view === 'picks' && (
        <div className="predictor">
          <div className="predictor-games">
            <div className="predictor-actions">
              <button type="button" onClick={pickFavorites}>Pick all favorites</button>
              <button type="button" onClick={() => setPicks({})} disabled={!pickCount}>Reset</button>
              <button type="button" onClick={share} disabled={!pickCount}>{copied ? 'Link copied' : 'Copy share link'}</button>
              <span className="muted small">{pickCount}/{open.length} picked</span>
            </div>
            {Object.entries(weeks).map(([week, games]) => (
              <div key={week} className="card pick-week">
                <h3 className="card-title">Week {week}</h3>
                {games.map((g) => <GamePick key={g.id} game={g} teams={teams} pick={picks?.[g.id]} onPick={setPick} />)}
              </div>
            ))}
            {!open.length && <div className="state">Regular season complete.</div>}
          </div>
          <div className="predictor-results">
            <p className="muted small">{shown.picked ? `${shown.picked} picks applied; ${shown.unpicked} games still open (not counted).` : 'Current standings (no picks yet). % = win probability.'}</p>
            {['AFC', 'NFC'].map((conf) => <SeedList key={conf} conf={conf} data={shown.conferences[conf]} />)}
          </div>
        </div>
      )}

      {view === 'picks' && (
        <>
          <h2 className="section-title">Division standings {result ? '(with your picks)' : ''}</h2>
          <DivisionTables divisions={shown.divisions} />
          <p className="muted small note">Tiebreakers: {overview.model.tiebreakers}</p>
          <Updated at={overview.last_updated} />
        </>
      )}
    </section>
  );
}
