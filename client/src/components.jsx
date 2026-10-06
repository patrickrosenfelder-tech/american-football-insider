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
