import { Link } from 'react-router-dom';
import { formatKickoff, formatTimestamp, isLive } from './api.js';

export function Loading({ label = 'Loading…' }) {
  return <div className="state skeleton-state" role="status" aria-label={label}><div className="skeleton-line wide" /><div className="skeleton-line" /><span className="sr-only">{label}</span></div>;
}

// Placeholders built from the real page classes so they occupy the same space as the loaded content.
export function PageHeadSkeleton() {
  return <div className="page-head"><div className="grow"><span className="skeleton-block skeleton-title" /><span className="skeleton-block skeleton-sub" /></div></div>;
}

export function GameCardSkeleton() {
  const Team = () => (
    <div className="game-card-team">
      <strong className="skeleton-block" /><span className="skeleton-block" />
      <div className="game-card-mark"><span className="logo-fallback" style={{ width: 54, height: 54 }} /></div>
    </div>
  );
  return (
    <article className="card game-card skeleton-card" aria-hidden="true">
      <div className="game-card-main"><div className="game-card-teams"><Team /><Team /></div><div className="game-card-meta"><span className="skeleton-block" /></div></div>
    </article>
  );
}

export function ScoresSkeleton({ label = 'Loading scoreboard…', cards = 6 }) {
  return (
    <section role="status" aria-label={label}>
      <div className="scores-hero">
        <PageHeadSkeleton />
        <div className="score-filters">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton-block skeleton-pill" />)}</div>
      </div>
      <div className="day-group">
        <div className="scores-section-head"><span className="skeleton-block skeleton-sub" /></div>
        <div className="grid games-grid">{Array.from({ length: cards }, (_, i) => <GameCardSkeleton key={i} />)}</div>
      </div>
      <span className="sr-only">{label}</span>
    </section>
  );
}

export function TableSkeleton({ rows = 6 }) {
  return <div className="card table-card" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton-block skeleton-row" />)}</div>;
}

export function PageSkeleton({ label = 'Loading…', hero = false, tables = 2, rows = 6 }) {
  return (
    <section role="status" aria-label={label}>
      {hero ? <div className="card skeleton-block skeleton-hero" /> : <PageHeadSkeleton />}
      {Array.from({ length: tables }, (_, i) => <TableSkeleton key={i} rows={rows} />)}
      <span className="sr-only">{label}</span>
    </section>
  );
}

export function ErrorBox({ error, onRetry }) {
  return <div className="state error" role="alert"><p>Couldn’t load data: {error?.message || String(error)}</p><button className="btn retry-btn" onClick={onRetry || (() => window.location.reload())}>Retry</button></div>;
}

// ESPN's 500 px logos are served as local 96/192 px copies (scripts/fetch-logos.js).
const LOCAL_LOGO = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/nfl\/500\/(?:scoreboard\/)?([a-z]{2,3})\.png$/i;
const LOCAL_TEAMS = new Set(['ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle', 'dal', 'den', 'det', 'gb', 'hou', 'ind', 'jax', 'kc', 'lac', 'lar', 'lv', 'mia', 'min', 'ne', 'no', 'nyg', 'nyj', 'phi', 'pit', 'sea', 'sf', 'tb', 'ten', 'wsh']);
export function localLogo(src) {
  const team = LOCAL_LOGO.exec(src || '')?.[1]?.toLowerCase();
  return team && LOCAL_TEAMS.has(team) ? team : null;
}

export function Logo({ src, alt, size = 28, eager = false }) {
  if (!src) return <span className="logo-fallback" style={{ width: size, height: size }} />;
  const team = localLogo(src);
  const loading = eager ? 'eager' : 'lazy';
  if (!team) return <img className="logo" src={src} alt={alt || ''} width={size} height={size} loading={loading} decoding="async" />;
  return (
    <img className="logo" src={`/logos/${team}-96.webp`} srcSet={`/logos/${team}-96.webp 96w, /logos/${team}-192.webp 192w`} sizes={`${size}px`}
      alt={alt || ''} width={size} height={size} loading={loading} decoding="async" />
  );
}

export function StatusPill({ game }) {
  const { state, detail } = game.status;
  if (state === 'in') return <span className="pill live"><span className="dot" />{detail}</span>;
  if (state === 'post') return <span className="pill final">{detail || 'Final'}</span>;
  return <span className="pill pre">{formatKickoff(game.date)}</span>;
}

function TeamRow({ team, game }) {
  const showScore = game.status.state !== 'pre';
  const lost = game.status.state === 'post' && !team.winner;
  return (
    <div className={`team-row ${lost ? 'lost' : ''}`}>
      <Logo src={team.logo} alt={team.abbreviation} />
      <span className="team-name">
        <span className="full" title={team.name}>{team.short_name}</span>
        {team.record && <span className="record">{team.record}</span>}
      </span>
      {game.possession && game.possession === team.id && <span className="possession" title="Possession">🏈</span>}
      {showScore && <span className="score">{team.score ?? '–'}</span>}
    </div>
  );
}

// "BUF,KC": filter value for the injury report and news feed of one matchup.
export const matchupTeams = (game) => [game.away?.abbreviation, game.home?.abbreviation].filter(Boolean).join(',');

export function GameCard({ game, eager = false }) {
  const accent = game.home?.color || game.away?.color || '#0b1c2d';
  const showScore = game.status.state !== 'pre';
  const Team = ({ team }) => (
    <div className={`game-card-team ${game.status.state === 'post' && !team.winner ? 'lost' : ''}`}>
      <strong>{team.short_name || team.name}</strong>
      {team.record && <span>{team.record}</span>}
      <div className="game-card-mark">
        <Logo src={team.logo} alt={team.abbreviation} size={54} eager={eager} />
        {showScore && <b className="game-card-score">{team.score ?? '–'}</b>}
      </div>
    </div>
  );
  return (
    <article className={`card game-card ${isLive(game) ? 'is-live' : ''} ${game.status.state === 'post' ? 'is-final' : ''}`} style={{ '--team-accent': accent }}>
      <Link to={game.status.state === 'pre' ? `/preview/${game.game_id}` : `/game/${game.game_id}`} className="game-card-main">
        <div className="game-card-teams">
          <Team team={game.away} />
          <Team team={game.home} />
        </div>
        <div className="game-card-meta">
          <StatusPill game={game} />
          {game.broadcast && <span>{game.broadcast}</span>}
          {isLive(game) && game.down_distance && <span className="situation">{game.down_distance}</span>}
          {game.status.state === 'pre' && game.odds && <span>{game.odds}</span>}
        </div>
      </Link>
      {game.status.state === 'post' && (
        <div className="game-card-links" aria-label="Postgame information">
          <Link to={`/game/${game.game_id}`}>Game center</Link>
          <Link to={`/preview/${game.game_id}`}>Preview</Link>
          <Link to={`/weather/game/${game.game_id}`}>Weather</Link>
          <Link to={`/injuries?team=${matchupTeams(game)}`}>Injuries</Link>
          <Link to={`/news?team=${matchupTeams(game)}`}>News</Link>
        </div>
      )}
    </article>
  );
}

export function FeaturedFinal({ game }) {
  const accent = game.home?.winner ? game.home.color : game.away?.color || game.home?.color || '#0b1c2d';
  const Team = ({ team, align }) => (
    <div className={`featured-team ${align} ${team.winner ? 'winner' : ''}`}>
      <Logo src={team.logo} alt={team.name} size={64} />
      <div>
        <strong>{team.name || team.short_name}</strong>
        {team.record && <span>{team.record}</span>}
        {team.abbreviation && <em>{team.abbreviation}</em>}
      </div>
    </div>
  );
  return (
    <Link to={`/game/${game.game_id}`} className="featured-final card" style={{ '--team-accent': accent }}>
      <div className="featured-matchup">
        <Team team={game.away} align="away" />
        <b className="featured-score away-score" aria-label={`${game.away.name} score ${game.away.score ?? 'not available'}`}>{game.away.score ?? '–'}</b>
        <span className="final-badge">FINAL</span>
        <b className="featured-score home-score" aria-label={`${game.home.name} score ${game.home.score ?? 'not available'}`}>{game.home.score ?? '–'}</b>
        <Team team={game.home} align="home" />
      </div>
      <div className="featured-footer">
        <span>{game.broadcast || 'Game complete'}</span>
        <span className="replay-link">Watch Replay <span aria-hidden="true">→</span></span>
      </div>
    </Link>
  );
}

const INJURY_ABBR = { Out: 'O', Doubtful: 'D', Questionable: 'Q', 'Injured Reserve': 'IR', 'Physically Unable to Perform': 'PUP', Suspension: 'SUSP' };

export function injuryAbbr(status = '') {
  if (INJURY_ABBR[status]) return INJURY_ABBR[status];
  if (/PUP/i.test(status)) return 'PUP';
  if (/reserve/i.test(status)) return 'IR';
  return status.slice(0, 3).toUpperCase();
}

export function InjuryBadge({ injury, small }) {
  if (!injury?.status) return null;
  const abbr = injuryAbbr(injury.status);
  return (
    <span className={`inj inj-${abbr.toLowerCase()} ${small ? 'sm' : ''}`} title={`${injury.status}${injury.injury ? ` — ${injury.injury}` : ''}`}>
      {abbr}
    </span>
  );
}

export function Updated({ at, label = 'Last updated', staleHours = 6 }) {
  if (!at) return null;
  const date = new Date(at);
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  const relative = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'} ago` : `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'} ago`;
  const stale = minutes >= staleHours * 60;
  return <p className={`updated muted small ${stale ? 'stale-note' : ''}`}>{stale && 'Results may be stale — '}{label}: {relative} ({formatTimestamp(at)})</p>;
}

export function StaleData({ at }) {
  if (!at) return <div className="stale-banner">Results may be stale — refresh failed.</div>;
  return <div className="stale-banner">Results may be stale — last updated at {formatTimestamp(at)}.</div>;
}
