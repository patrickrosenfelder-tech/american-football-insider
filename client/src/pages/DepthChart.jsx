import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.js';
import { Loading, ErrorBox, InjuryBadge, Updated } from '../components.jsx';

// Field layouts: [slotKey, gridColumn, gridRow] on a 9-column formation grid.
const LAYOUTS = {
  offense: [
    ['wr1', 1, 1], ['lt', 3, 1], ['lg', 4, 1], ['c', 5, 1], ['rg', 6, 1], ['rt', 7, 1], ['te', 8, 1], ['wr2', 9, 1],
    ['wr3', 2, 2], ['qb', 5, 2],
    ['fb', 4, 3], ['rb', 5, 3]
  ],
  '4-3': [
    ['fs', 4, 1], ['ss', 6, 1],
    ['lcb', 1, 2], ['nb', 2, 2], ['slb', 3, 2], ['mlb', 5, 2], ['wlb', 7, 2], ['rcb', 9, 2],
    ['lde', 3, 3], ['ldt', 4, 3], ['rdt', 6, 3], ['rde', 7, 3]
  ],
  '3-4': [
    ['fs', 4, 1], ['ss', 6, 1],
    ['lcb', 1, 2], ['nb', 2, 2], ['lilb', 4, 2], ['rilb', 6, 2], ['rcb', 9, 2],
    ['wlb', 2, 3], ['lde', 3, 3], ['nt', 5, 3], ['rde', 7, 3], ['slb', 8, 3]
  ]
};

function PlayerCard({ slot, expanded }) {
  const [starter, ...backups] = slot.players;
  if (!starter) {
    return <div className="dc-card empty"><span className="dc-pos">{slot.label}</span><span className="muted small">Vacant</span></div>;
  }
  return (
    <div className="dc-slot">
      <Link to={`/players/${starter.id}`} className="dc-card" title={`${starter.name} — ${slot.espn_position_name || slot.label}`}>
        <span className="dc-pos">{slot.label}</span>
        <img className="dc-headshot" src={starter.headshot} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        <span className="dc-name">{starter.short_name}</span>
        {starter.jersey && <span className="dc-num">#{starter.jersey}</span>}
        <InjuryBadge injury={starter.injury} />
      </Link>
      {expanded && backups.slice(0, 2).map((p) => (
        <Link key={p.id} to={`/players/${p.id}`} className="dc-backup">
          <span className="dc-depth">{p.depth}</span>
          <span className="grow">{p.short_name}</span>
          <InjuryBadge injury={p.injury} small />
        </Link>
      ))}
    </div>
  );
}

function Formation({ unit, layoutKey, expanded }) {
  const layout = LAYOUTS[layoutKey];
  const bySlot = Object.fromEntries(unit.slots.map((s) => [s.key, s]));
  const placed = new Set();
  const cells = layout.filter(([key]) => bySlot[key]).map(([key, col, row]) => {
    placed.add(key);
    return <div key={key} style={{ gridColumn: col, gridRow: row }}><PlayerCard slot={bySlot[key]} expanded={expanded} /></div>;
  });
  const extra = unit.slots.filter((s) => !placed.has(s.key));
  return (
    <>
      <div className={`field field-${layoutKey === 'offense' ? 'offense' : 'defense'}`}>
        <div className="formation">{cells}</div>
      </div>
      {extra.length > 0 && (
        <div className="dc-row">{extra.map((s) => <PlayerCard key={s.key} slot={s} expanded={expanded} />)}</div>
      )}
    </>
  );
}

export default function DepthChart({ teamId }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('unit') || 'offense';
  const setTab = (unit) => setParams({ tab: 'depth', unit }, { replace: true });
  const [expanded, setExpanded] = useState(false);
  const { data, error, loading } = useApi(`/teams/${teamId}/depthchart`);
  if (loading) return <Loading label="Loading depth chart…" />;
  if (error) return <ErrorBox error={error} />;
  const d = data.data;
  const tabs = [
    ['offense', 'Offense', d.offense],
    ['defense', `Defense${d.base_defense ? ` (${d.base_defense})` : ''}`, d.defense],
    ['special', 'Special Teams', d.special_teams]
  ];
  const unit = tabs.find(([k]) => k === tab)?.[2];

  return (
    <div>
      <div className="tabbar">
        <div className="tabs">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={expanded} onChange={(e) => setExpanded(e.target.checked)} /> Show depth 2–3
        </label>
      </div>
      {!unit && <div className="state">No depth chart published for this unit.</div>}
      {unit && tab === 'offense' && <Formation unit={unit} layoutKey="offense" expanded={expanded} />}
      {unit && tab === 'defense' && <Formation unit={unit} layoutKey={d.base_defense || '4-3'} expanded={expanded} />}
      {unit && tab === 'special' && (
        <div className="dc-row">{unit.slots.map((s) => <PlayerCard key={s.key} slot={s} expanded={expanded} />)}</div>
      )}
      <p className="muted small note">
        {unit?.formation && <>ESPN depth chart formation: {unit.formation}. </>}
        Tap a card for the player page. Badges show current injury status (O / D / Q / IR / PUP).
      </p>
      <Updated at={d.last_updated} />
    </div>
  );
}
