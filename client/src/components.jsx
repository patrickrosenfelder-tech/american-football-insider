import { Link } from 'react-router-dom';
import { formatKickoff, isLive } from './api.js';

export function Loading({ label = 'Loading…' }) {
  return <div className="state"><span className="spinner" /> {label}</div>;
}

export function ErrorBox({ error }) {
  return <div className="state error">Couldn’t load data: {error?.message || String(error)}</div>;
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
  return (
    <Link to={`/game/${game.game_id}`} className={`card game-card ${isLive(game) ? 'is-live' : ''}`}>
      <div className="game-card-head">
        <StatusPill game={game} />
        {game.broadcast && <span className="muted small">{game.broadcast}</span>}
      </div>
      <TeamRow team={game.away} game={game} />
      <TeamRow team={game.home} game={game} />
      {isLive(game) && game.down_distance && <div className="situation">{game.down_distance}</div>}
      {game.status.state === 'pre' && game.odds && <div className="muted small">Line: {game.odds}</div>}
    </Link>
  );
}

// AFI rating badge: our own 0-99 rating (not Madden). null = not rated.
export function RatingBadge({ rating, small, large }) {
  const tier = rating == null ? 'nr' : rating >= 90 ? 'elite' : rating >= 80 ? 'good' : rating >= 70 ? 'avg' : 'low';
  return (
    <span className={`rating rating-${tier} ${small ? 'sm' : ''} ${large ? 'lg' : ''}`} title={rating == null ? 'Not rated yet' : `AFI rating ${rating}`}>
      {rating ?? 'NR'}
    </span>
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

export function Updated({ at, label = 'Last updated' }) {
  if (!at) return null;
  return <p className="updated muted small">{label}: {new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>;
}
