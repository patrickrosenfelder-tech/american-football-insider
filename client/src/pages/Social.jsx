import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api.js';
import { Loading } from '../components.jsx';

const REFRESH_MS = 60000;
const live = { refreshMs: REFRESH_MS, shouldRefresh: () => true };

const PLATFORMS = { bluesky: { label: 'Bluesky', icon: '🦋' }, youtube: { label: 'YouTube', icon: '▶' }, reddit: { label: 'Reddit', icon: '👽' } };

export const shortAgo = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  if (m < 24 * 60) return `${Math.round(m / 60)}h`;
  if (m < 7 * 24 * 60) return `${Math.round(m / 1440)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

const URL_RE = /(https?:\/\/[^\s]+)/g;
const linkify = (text) => text.split(URL_RE).map((part, i) => (i % 2
  ? <a key={i} href={part} target="_blank" rel="noreferrer" className="social-link">{part.replace(/^https?:\/\//, '')}</a>
  : part));

function PostText({ p }) {
  if (p.segments) {
    return <p className="social-text">{p.segments.map((s, i) => (s.href ? <a key={i} href={s.href} target="_blank" rel="noreferrer" className="social-link">{s.text}</a> : <span key={i}>{s.text}</span>))}</p>;
  }
  return <p className="social-text">{linkify(p.text)}</p>;
}

function Avatar({ p }) {
  if (p.author.avatar) return <img className="social-avatar" src={p.author.avatar} alt="" loading="lazy" />;
  return <span className={`social-avatar fallback ${p.platform}`}>{PLATFORMS[p.platform]?.icon || p.author.name[0]}</span>;
}

// Bluesky videos are HLS (.m3u8). Safari plays HLS natively; other browsers use hls.js (loaded on demand).
function HlsVideo({ src, poster, aspect }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    let hls = null;
    let cancelled = false;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => {});
    } else {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      });
    }
    return () => { cancelled = true; if (hls) hls.destroy(); };
  }, [src]);
  const ratio = aspect?.width && aspect?.height ? `${aspect.width} / ${aspect.height}` : '16 / 9';
  const portrait = aspect?.height > aspect?.width;
  return (
    <div className={`social-video ${portrait ? 'short' : ''}`} style={{ aspectRatio: ratio }}>
      <video ref={ref} poster={poster || undefined} controls playsInline />
    </div>
  );
}

function Media({ p }) {
  const [playing, setPlaying] = useState(false);
  const m = p.media;
  if (!m) return null;
  if (m.type === 'video' && m.playlist) {
    if (playing) return <HlsVideo src={m.playlist} poster={m.thumb} aspect={m.aspect} />;
    return (
      <button type="button" className="social-media video" onClick={() => setPlaying(true)} aria-label="Play video">
        {m.thumb && <img src={m.thumb} alt="" loading="lazy" />}<span className="social-play">▶</span>
      </button>
    );
  }
  if (m.type === 'youtube') {
    if (playing) {
      return (
        <div className={`social-video ${m.short ? 'short' : ''}`}>
          <iframe src={`https://www.youtube-nocookie.com/embed/${m.video_id}?autoplay=1`} title={p.text} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
      );
    }
    return (
      <button type="button" className="social-media video" onClick={() => setPlaying(true)} aria-label={`Play ${p.text}`}>
        <img src={m.thumb} alt="" loading="lazy" /><span className="social-play">▶</span>
      </button>
    );
  }
  if (m.type === 'link') {
    return (
      <a href={m.url} target="_blank" rel="noreferrer" className="social-linkcard">
        {m.thumb && <img src={m.thumb} alt="" loading="lazy" />}
        <span><b>{m.title || m.url}</b>{m.description && <span className="muted small"> {m.description}</span>}</span>
      </a>
    );
  }
  if (!m.thumb) return null;
  return (
    <a href={m.full || m.url || p.url} target="_blank" rel="noreferrer" className={`social-media ${m.type}`}>
      <img src={m.thumb} alt={m.alt || ''} loading="lazy" />
      {m.type === 'video' && <span className="social-play">▶</span>}
      {m.count > 1 && <span className="social-count">+{m.count - 1}</span>}
    </a>
  );
}

export function SocialCard({ p }) {
  const plat = PLATFORMS[p.platform] || { label: p.platform, icon: '•' };
  return (
    <article className={`social-card ${p.breaking ? 'breaking' : ''}`}>
      <header className="social-head">
        <a href={p.author.url} target="_blank" rel="noreferrer"><Avatar p={p} /></a>
        <div className="grow social-who">
          <a href={p.author.url} target="_blank" rel="noreferrer"><b>{p.author.name}</b></a>
          {p.author.handle !== p.author.name && <span className="muted small"> {p.author.handle}</span>}
        </div>
        <span className={`social-badge ${p.platform}`} title={plat.label}>{plat.icon} {plat.label}</span>
        <a href={p.url} target="_blank" rel="noreferrer" className="muted small" title={new Date(p.published).toLocaleString()}>{shortAgo(p.published)}</a>
      </header>
      {p.breaking && <span className="social-breaking">Breaking</span>}
      {p.flair && <span className="tag">{p.flair}</span>}
      {p.platform === 'youtube' ? <p className="social-text"><b>{p.text}</b></p> : <PostText p={p} />}
      {p.body && <p className="social-text muted small">{p.body}</p>}
      <Media p={p} />
      <footer className="social-foot muted small">
        {p.teams.slice(0, 3).map((t) => <Link key={t} to={`/teams/${t}`} className="tag">{t}</Link>)}
        {p.platform === 'reddit' && <span>▲ {compact(p.metrics.score)} · 💬 {compact(p.metrics.comments)}</span>}
        {p.platform === 'youtube' && p.metrics.views > 0 && <span>{compact(p.metrics.views)} views</span>}
        <a href={p.url} target="_blank" rel="noreferrer" className="grow-right"><u>View on {plat.label} ↗</u></a>
      </footer>
    </article>
  );
}

// Compact feed for the /news sidebar and team pages. On narrow screens it collapses behind a toggle.
export function SocialWidget({ team = null, limit = 12, title = 'Social' }) {
  const [open, setOpen] = useState(false);
  const qs = new URLSearchParams({ limit: String(limit) });
  if (team) qs.set('team', team);
  const { data, error, loading } = useApi(`/social?${qs}`, live);
  const posts = data?.data.posts || [];
  const breaking = posts.filter((p) => p.breaking).length;
  return (
    <aside className="social-widget">
      <button type="button" className="social-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{title}{breaking > 0 && <span className="social-breaking inline">{breaking} breaking</span>}</span>
        <span className="muted">{open ? '▲' : '▼'}</span>
      </button>
      <div className={`social-body ${open ? 'open' : ''}`}>
        <div className="social-widget-head">
          <h2 className="section-title">{title}</h2>
        </div>
        {loading && <Loading label="Loading posts…" />}
        {error && <p className="muted small">Social feed unavailable: {error.message}</p>}
        {data && !posts.length && <p className="muted small">No recent posts{team ? ` about ${team}` : ''}.</p>}
        <div className="social-list">{posts.map((p) => <SocialCard key={p.id} p={p} />)}</div>
      </div>
    </aside>
  );
}
