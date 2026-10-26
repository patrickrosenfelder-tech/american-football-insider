// 1200x630 social share cards (og:image), drawn as SVG and rasterised with resvg.
// The brand card is pre-built into client/public/og-image.png (scripts/build-brand-assets.js);
// matchup cards for /game/:id and /preview/:id are rendered on demand and cached in memory.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { formatKickoff } = require('./prerender');

const W = 1200;
const H = 630;
const FONT = 'DejaVu Sans, Helvetica Neue, Helvetica, Arial, sans-serif';
const NAVY = '#0b1730';
const LOGO_DIRS = [path.join(__dirname, '../../client/dist/logos'), path.join(__dirname, '../../client/public/logos')];
// The Docker image ships only DejaVu (fonts-dejavu-core); elsewhere fall back to the system fonts.
const DEJAVU = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((f) => path.join('/usr/share/fonts/truetype/dejavu', f)).filter((f) => fs.existsSync(f));
const FONT_OPTIONS = DEJAVU.length ? { fontFiles: DEJAVU, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' } : { loadSystemFonts: true, defaultFontFamily: 'Helvetica' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fallback);
// Darken a team color so white text on it stays readable.
const shade = (c, f = 0.55) => `#${[1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('')}`;

const logoData = (abbreviation) => {
  const team = String(abbreviation || '').toLowerCase();
  if (!/^[a-z]{2,3}$/.test(team)) return null;
  for (const dir of LOGO_DIRS) {
    const file = path.join(dir, `${team}-192.png`);
    if (fs.existsSync(file)) return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  }
  return null;
};

const toPng = (svg) => new Resvg(svg, { font: FONT_OPTIONS, fitTo: { mode: 'original' } }).render().asPng();

const football = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s / 64})"><rect width="64" height="64" rx="14" fill="${NAVY}"/><ellipse cx="32" cy="32" rx="22" ry="13" transform="rotate(-35 32 32)" fill="#8b4513"/><path d="M22 42 42 22M27 33l4 4M31 29l4 4M35 25l4 4" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></g>`;

const brandCardSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#13284f"/><stop offset="1" stop-color="${NAVY}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect y="${H - 14}" width="${W}" height="14" fill="#ef5b3f"/>
  ${football(96, 150, 150)}
  <text x="290" y="215" font-family="${FONT}" font-size="76" font-weight="700" fill="#ffffff">Football <tspan fill="#ef5b3f">Insider</tspan></text>
  <text x="292" y="275" font-family="${FONT}" font-size="34" fill="#c9d6ec">Live NFL scores, standings and picks</text>
  <text x="96" y="430" font-family="${FONT}" font-size="30" fill="#ffffff">Matchup previews · Injuries · Weather · Playoff odds</text>
  <text x="96" y="545" font-family="${FONT}" font-size="26" fill="#9fb2d3">american-football-insider.fly.dev</text>
</svg>`;

const statusLine = (game) => {
  if (game.status?.state === 'post') return (game.status.detail || 'Final').toUpperCase();
  if (game.status?.state === 'in') return `LIVE · ${game.status.detail || ''}`.trim();
  return formatKickoff(game.date);
};

// kind: 'game' | 'preview'. game: normalized ESPN event (sportsDataService.getGameDetail).
const matchupCardSvg = (game, kind = 'game') => {
  const started = game.status?.state && game.status.state !== 'pre';
  const side = (team, x0) => {
    const color = shade(hex(team.color, '#33415c'));
    const logo = logoData(team.abbreviation);
    const cx = x0 + W / 4;
    return `<rect x="${x0}" y="0" width="${W / 2}" height="${H}" fill="${color}"/>
      <circle cx="${cx}" cy="230" r="118" fill="#ffffff"/>
      ${logo ? `<image x="${cx - 88}" y="142" width="176" height="176" href="${logo}"/>` : `<text x="${cx}" y="256" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="700" fill="${NAVY}">${esc(team.abbreviation)}</text>`}
      <text x="${cx}" y="408" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="700" fill="#ffffff">${esc(team.short_name || team.name)}</text>
      ${team.record ? `<text x="${cx}" y="450" text-anchor="middle" font-family="${FONT}" font-size="26" fill="#e3e9f5">${esc(team.record)}</text>` : ''}
      ${started && team.score != null ? `<text x="${cx}" y="540" text-anchor="middle" font-family="${FONT}" font-size="84" font-weight="700" fill="#ffffff">${esc(team.score)}</text>` : ''}`;
  };
  const label = kind === 'preview' ? 'MATCHUP PREVIEW' : started ? 'GAME CENTER' : 'UPCOMING';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${side(game.away || {}, 0)}
  ${side(game.home || {}, W / 2)}
  <rect x="${W / 2 - 3}" y="0" width="6" height="${H}" fill="#ffffff" opacity="0.5"/>
  <circle cx="${W / 2}" cy="230" r="44" fill="${NAVY}" stroke="#ffffff" stroke-width="4"/>
  <text x="${W / 2}" y="243" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffffff">${started ? 'vs' : '@'}</text>
  <rect x="0" y="0" width="${W}" height="64" fill="${NAVY}" opacity="0.92"/>
  ${football(24, 10, 44)}
  <text x="82" y="43" font-family="${FONT}" font-size="26" font-weight="700" fill="#ffffff">Football <tspan fill="#ef5b3f">Insider</tspan></text>
  <text x="${W - 28}" y="43" text-anchor="end" font-family="${FONT}" font-size="24" font-weight="700" fill="#c9d6ec">${label}</text>
  <rect x="0" y="${H - 64}" width="${W}" height="64" fill="${NAVY}" opacity="0.92"/>
  <text x="${W / 2}" y="${H - 22}" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="700" fill="#ffffff">${esc(statusLine(game))}</text>
</svg>`;
};

// Small in-memory LRU: the key includes score and status, so a cached card is never stale.
const MAX_CACHED = 64;
const cache = new Map();
const matchupCard = (game, kind) => {
  const key = [kind, game.game_id, game.status?.state, game.status?.detail, game.away?.score, game.home?.score, game.date, game.away?.record, game.home?.record].join('|');
  if (cache.has(key)) {
    const png = cache.get(key);
    cache.delete(key); cache.set(key, png);
    return png;
  }
  const png = toPng(matchupCardSvg(game, kind));
  cache.set(key, png);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return png;
};

module.exports = { brandCardSvg, matchupCardSvg, matchupCard, toPng, football, W, H };
