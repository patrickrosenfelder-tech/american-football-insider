import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api.js';
import { Loading, ErrorBox, Logo, Updated } from '../components.jsx';

const fmt = (v, suffix = '%') => (v == null ? '–' : `${v}${suffix}`);

function Bar({ label, pct, sub }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, pct || 0)}%` }} /></span>
      <span className="bar-val">{fmt(pct)}{sub && <small className="muted"> {sub}</small>}</span>
    </div>
  );
}

function Metric({ label, value, league, suffix = '%' }) {
  return (
    <div><dt>{label}</dt><dd>{fmt(value, suffix)}{league != null && <span className="muted small"> (NFL {fmt(league, suffix)})</span>}</dd></div>
  );
}

export function DataThrough({ current, reference }) {
  if (!current) return null;
  const s = current.sources || {};
  return (
    <div className="data-through">
      <b>Data through Week {current.data_through_week}</b> ({current.year ?? current.season})
      <span className="muted small"> · play-by-play through Wk {s.pbp?.through_week ?? '–'}
        {s.ftn ? `, FTN charting through Wk ${s.ftn.through_week}` : ', FTN charting not available'}
        {reference ? ` · personnel & coverage: ${reference.season} season (2026 not published yet)` : ''}</span>
    </div>
  );
}

export function TeamTendencies({ teamId }) {
  const [scope, setScope] = useState('season');
  const { data, error, loading } = useApi(`/teams/${teamId}/tendencies`);
  if (loading) return <Loading label="Loading tendencies…" />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  const cur = d.current;
  const view = cur?.[scope] || cur?.season;
  const lg = cur?.league;
  const o = view?.offense;
  const df = view?.defense;
  const ref = d.reference;

  return (
    <div>
      <div className="tabbar">
        <div className="tabs">
          <button type="button" className={scope === 'season' ? 'active' : ''} onClick={() => setScope('season')}>Season</button>
          <button type="button" className={scope === 'last3' ? 'active' : ''} onClick={() => setScope('last3')} disabled={!cur?.last3}>Last 3 games</button>
        </div>
      </div>
      <DataThrough current={cur} reference={ref} />

      {o && (
        <div className="grid two-col">
          <div className="card">
            <h3 className="card-title">Offense · {o.plays} plays</h3>
            <dl className="stat-list">
              <Metric label="Pass rate" value={o.pass_rate} league={lg.offense.pass_rate} />
              <Metric label="Neutral-situation pass rate" value={o.neutral_pass_rate} league={lg.offense.neutral_pass_rate} />
              <Metric label="Shotgun" value={o.shotgun_rate} league={lg.offense.shotgun_rate} />
              <Metric label="Under center" value={o.under_center_rate} league={lg.offense.under_center_rate} />
              <Metric label="No-huddle" value={o.no_huddle_rate} league={lg.offense.no_huddle_rate} />
              <Metric label="Pace (sec between snaps, in-drive)" value={o.seconds_per_play} league={lg.offense.seconds_per_play} suffix="s" />
              {o.ftn && <>
                <Metric label="Pre-snap motion" value={o.ftn.motion_rate} league={lg.offense.ftn?.motion_rate} />
                <Metric label="Play action (of dropbacks)" value={o.ftn.play_action_rate} league={lg.offense.ftn?.play_action_rate} />
                <Metric label="Screens (of dropbacks)" value={o.ftn.screen_rate} league={lg.offense.ftn?.screen_rate} />
                <Metric label="RPO" value={o.ftn.rpo_rate} league={lg.offense.ftn?.rpo_rate} />
              </>}
              <Metric label="EPA / play" value={o.epa_per_play} league={lg.offense.epa_per_play} suffix="" />
              <Metric label="Success rate" value={o.success_rate} league={lg.offense.success_rate} />
            </dl>
            {o.ftn && (
              <>
                <h4 className="sub-title">QB alignment (FTN)</h4>
                {o.ftn.qb_alignment.map((x) => <Bar key={x.key} label={x.label} pct={x.pct} />)}
                <h4 className="sub-title">Backfield (FTN)</h4>
                {o.ftn.backfield.map((x) => <Bar key={x.key} label={x.label} pct={x.pct} />)}
              </>
            )}
          </div>

          <div className="card">
            <h3 className="card-title">Defense · {df.plays} plays faced</h3>
            <dl className="stat-list">
              <div><dt>Base front</dt><dd>{d.base_front_depth_chart || '–'} <span className="muted small">(ESPN depth chart)</span>{ref?.defense?.derived_base_front && <span className="muted small"> · {ref.defense.derived_base_front} derived from {ref.season} personnel</span>}</dd></div>
              <Metric label="Pass rate faced" value={df.pass_rate_faced} league={lg.defense.pass_rate_faced} />
              {df.ftn && <>
                <Metric label="Blitz rate (of dropbacks)" value={df.ftn.blitz_rate} league={lg.defense.ftn?.blitz_rate} />
                <Metric label="Avg pass rushers" value={df.ftn.avg_pass_rushers} league={lg.defense.ftn?.avg_pass_rushers} suffix="" />
                <Metric label="Avg defenders in box" value={df.ftn.avg_box} league={lg.defense.ftn?.avg_box} suffix="" />
                <Metric label="8+ man box" value={df.ftn.heavy_box_rate} league={lg.defense.ftn?.heavy_box_rate} />
              </>}
              <Metric label="EPA / play allowed" value={df.epa_per_play_allowed} league={lg.defense.epa_per_play_allowed} suffix="" />
              <Metric label="Success rate allowed" value={df.success_rate_allowed} league={lg.defense.success_rate_allowed} />
            </dl>
          </div>
        </div>
      )}

      {ref && (
        <>
          <h2 className="section-title">Personnel &amp; coverage · {ref.season} season</h2>
          <p className="muted small">{ref.note}</p>
          <div className="grid two-col">
            <div className="card">
              <h3 className="card-title">Offensive personnel ({ref.season})</h3>
              {ref.offense.personnel?.length ? (
                <table>
                  <thead><tr><th className="left">Group</th><th>Usage</th><th>Pass rate</th><th>EPA/play</th></tr></thead>
                  <tbody>
                    {ref.offense.personnel.filter((x) => x.pct >= 0.5).map((x) => (
                      <tr key={x.key}><td className="left"><b>{x.key}</b> <span className="muted small">{x.key[0]} RB, {x.key[1]} TE</span></td><td>{x.pct}%</td><td>{fmt(x.pass_rate)}</td><td>{x.epa_per_play ?? '–'}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="muted small">No data.</p>}
            </div>
            <div className="card">
              <h3 className="card-title">Defensive packages &amp; coverage ({ref.season})</h3>
              {ref.defense ? (
                <>
                  {ref.defense.packages.map((x) => <Bar key={x.key} label={x.label} pct={x.pct} />)}
                  <h4 className="sub-title">Man vs zone (pass plays)</h4>
                  <Bar label="Man" pct={ref.defense.man_rate} sub={ref.league?.defense?.man_rate != null ? `NFL ${ref.league.defense.man_rate}%` : ''} />
                  <Bar label="Zone" pct={ref.defense.zone_rate} sub={ref.league?.defense?.zone_rate != null ? `NFL ${ref.league.defense.zone_rate}%` : ''} />
                  <h4 className="sub-title">Coverage shells</h4>
                  {ref.defense.coverage_shells.filter((x) => x.pct >= 1).map((x) => <Bar key={x.key} label={x.label} pct={x.pct} />)}
                </>
              ) : <p className="muted small">No data.</p>}
            </div>
          </div>
        </>
      )}
      <p className="muted small note">Sources: nflverse play-by-play and FTN charting (free, CC-BY via nflverse); participation (personnel, man/zone, coverage) from nflverse pbp_participation. Last 3 = the team’s three most recent games.</p>
      <Updated at={d.updated_at} />
    </div>
  );
}

// [label, getter, suffix]
const LEAGUE_COLS = [
  ['Pass %', (t) => t.offense.pass_rate],
  ['Neutral pass %', (t) => t.offense.neutral_pass_rate],
  ['Shotgun %', (t) => t.offense.shotgun_rate],
  ['No-huddle %', (t) => t.offense.no_huddle_rate],
  ['Sec/play', (t) => t.offense.seconds_per_play, ''],
  ['Motion %', (t) => t.offense.motion_rate],
  ['PA %', (t) => t.offense.play_action_rate],
  ['Off EPA', (t) => t.offense.epa_per_play, ''],
  ['Blitz %', (t) => t.defense.blitz_rate],
  ['Rushers', (t) => t.defense.avg_pass_rushers, ''],
  ['Box', (t) => t.defense.avg_box, ''],
  ['Def EPA', (t) => t.defense.epa_per_play_allowed, ''],
  ['11 pers % *', (t) => t.reference?.personnel_11_rate],
  ['Nickel % *', (t) => t.reference?.nickel_rate],
  ['Man % *', (t) => t.reference?.man_rate],
  ['Top shell *', (t) => t.reference?.top_shell, ''],
  ['Front *', (t) => t.reference?.derived_base_front, '']
];

export default function TendenciesPage() {
  const [sort, setSort] = useState({ col: -1, dir: 1 });
  const { data, error, loading } = useApi('/tendencies');
  const teams = useApi('/teams');
  if (loading) return <Loading label="Loading tendencies…" />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  const logos = Object.fromEntries((teams.data?.data || []).map((t) => [t.abbreviation, t.logo]));
  const rows = [...d.teams];
  if (sort.col >= 0) {
    const get = LEAGUE_COLS[sort.col][1];
    rows.sort((a, b) => {
      const x = get(a); const y = get(b);
      if (x == null) return 1; if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Scheme tendencies</h1>
          <DataThrough current={d} reference={d.reference_season ? { season: d.reference_season } : null} />
        </div>
      </div>
      <div className="card table-card">
        <table className="tend-table">
          <thead>
            <tr>
              <th className="left">Team</th>
              {LEAGUE_COLS.map(([label], i) => (
                <th key={label} className="sortable" onClick={() => setSort((s) => ({ col: i, dir: s.col === i ? -s.dir : -1 }))}>
                  {label}{sort.col === i ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.team}>
                <td className="left"><Link to={`/teams/${t.team}?tab=tendencies`} className="team-cell"><Logo src={logos[t.team]} size={20} alt="" /> {t.team}</Link></td>
                {LEAGUE_COLS.map(([label, get, suffix]) => <td key={label}>{get(t) ?? '–'}{get(t) != null && suffix === undefined ? '' : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small note">
        Season to date. Blitz rate, pass rushers and box count from FTN charting; pace = average seconds between snaps within a drive.
        * Personnel, nickel, man/zone, coverage shell and derived front are from the {d.reference_season} season: nflverse publishes participation data only after a season ends.
        Click a column to sort.
      </p>
      <Updated at={d.last_updated} />
    </section>
  );
}

// Side-by-side tendencies for the matchup preview.
export function MatchupTendencies({ away, home }) {
  const a = useApi(`/teams/${away.abbreviation}/tendencies`);
  const h = useApi(`/teams/${home.abbreviation}/tendencies`);
  if (a.loading || h.loading) return <Loading label="Loading tendencies…" />;
  if (a.error || h.error) return <ErrorBox error={a.error || h.error} />;
  const A = a.data.data;
  const H = h.data.data;
  const ao = A.current?.season.offense; const ho = H.current?.season.offense;
  const ad = A.current?.season.defense; const hd = H.current?.season.defense;
  const ar = A.reference; const hr = H.reference;
  const top = (list, n = 2) => (list || []).slice(0, n).map((x) => `${x.label} ${x.pct}%`).join(', ') || '–';
  const p11 = (r) => r?.offense.personnel?.find((x) => x.key === '11')?.pct;
  const p12 = (r) => r?.offense.personnel?.find((x) => x.key === '12')?.pct;
  const rows = [
    ['Pass rate', ao?.pass_rate, ho?.pass_rate, '%'],
    ['Neutral pass rate', ao?.neutral_pass_rate, ho?.neutral_pass_rate, '%'],
    ['Shotgun', ao?.shotgun_rate, ho?.shotgun_rate, '%'],
    ['Pre-snap motion', ao?.ftn?.motion_rate, ho?.ftn?.motion_rate, '%'],
    ['Play action', ao?.ftn?.play_action_rate, ho?.ftn?.play_action_rate, '%'],
    ['Sec / play', ao?.seconds_per_play, ho?.seconds_per_play, 's'],
    ['Blitz rate (D)', ad?.ftn?.blitz_rate, hd?.ftn?.blitz_rate, '%'],
    ['Avg pass rushers (D)', ad?.ftn?.avg_pass_rushers, hd?.ftn?.avg_pass_rushers, ''],
    ['Avg box (D)', ad?.ftn?.avg_box, hd?.ftn?.avg_box, ''],
    ['Base front (D)', A.base_front_depth_chart, H.base_front_depth_chart, '']
  ];
  const refRows = ar && hr ? [
    ['11 personnel', p11(ar), p11(hr), '%'],
    ['12 personnel', p12(ar), p12(hr), '%'],
    ['Nickel/dime (D)', ar.defense?.packages && (100 - (ar.defense.packages.find((x) => x.key.startsWith('Base'))?.pct || 0)).toFixed(1), hr.defense?.packages && (100 - (hr.defense.packages.find((x) => x.key.startsWith('Base'))?.pct || 0)).toFixed(1), '%'],
    ['Man coverage (D)', ar.defense?.man_rate, hr.defense?.man_rate, '%'],
    ['Top shells (D)', top(ar.defense?.coverage_shells), top(hr.defense?.coverage_shells), '']
  ] : [];
  return (
    <>
      <h2 className="section-title">Scheme tendencies</h2>
      <DataThrough current={A.current} reference={ar} />
      <div className="grid two-col">
        <div className="card">
          <h3 className="card-title compare-head"><span>{away.abbreviation}</span><span>{A.current?.year ?? ''} season</span><span>{home.abbreviation}</span></h3>
          {rows.map(([label, x, y, s]) => (
            <div key={label} className="compare-row"><b>{x ?? '–'}{x != null ? s : ''}</b><span className="muted">{label}</span><b>{y ?? '–'}{y != null ? s : ''}</b></div>
          ))}
        </div>
        {refRows.length > 0 && (
          <div className="card">
            <h3 className="card-title compare-head"><span>{away.abbreviation}</span><span>Personnel &amp; coverage ({ar.season})</span><span>{home.abbreviation}</span></h3>
            {refRows.map(([label, x, y, s]) => (
              <div key={label} className="compare-row"><b>{x ?? '–'}{x != null ? s : ''}</b><span className="muted">{label}</span><b>{y ?? '–'}{y != null ? s : ''}</b></div>
            ))}
            <p className="muted small note">{ar.note}</p>
          </div>
        )}
      </div>
    </>
  );
}
