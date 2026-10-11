import { Link } from 'react-router-dom';
import { formatKickoff, isLive } from './api.js';

export function Loading({ label = 'Loading…' }) {
  return <div className="state skeleton-state" role="status" aria-label={label}><div className="skeleton-line wide" /><div className="skeleton-line" /><span className="sr-only">{label}</span></div>;
}

export function ErrorBox({ error, onRetry }) {
  return <div className="state error" role="alert"><p>Couldn’t load data: {error?.message || String(error)}</p><button className="btn retry-btn" onClick={onRetry || (() => window.location.reload())}>Retry</button></div>;
}

export function Logo({ src, alt, size = 28 }) {
  if (!src) return <span className="logo-fallback" style={{ width: size, height: size }} />;
  return <img className="logo" src={src} alt={alt || ''} width={size} height={size} loading="lazy" />;
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

export function GameCard({ game }) {
  const accent = game.home?.color || game.away?.color || '#0b1c2d';
  const showScore = game.status.state !== 'pre';
  const Team = ({ team }) => (
    <div className={`game-card-team ${game.status.state === 'post' && !team.winner ? 'lost' : ''}`}>
      <strong>{team.short_name || team.name}</strong>
      {team.record && <span>{team.record}</span>}
      <div className="game-card-mark">
        <Logo src={team.logo} alt={team.abbreviation} size={54} />
        {showScore && <b className="game-card-score">{team.score ?? '–'}</b>}
      </div>
    </div>
  );
  return (
    <Link to={game.status.state === 'pre' ? `/preview/${game.game_id}` : `/game/${game.game_id}`} className={`card game-card ${isLive(game) ? 'is-live' : ''}`} style={{ '--team-accent': accent }}>
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
        <b className="featured-score away-score" aria-label={`${game.away.name} score`}>{game.away.score ?? '–'}</b>
        <span className="final-badge">FINAL</span>
        <b className="featured-score home-score" aria-label={`${game.home.name} score`}>{game.home.score ?? '–'}</b>
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
  return <p className={`updated muted small ${stale ? 'stale-note' : ''}`}>{stale && 'Results may be stale — '}{label}: {relative} ({date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})</p>;
}

export function StaleData({ at }) {
  if (!at) return <div className="stale-banner">Results may be stale — refresh failed.</div>;
  return <div className="stale-banner">Results may be stale — last updated at {new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.</div>;
}
