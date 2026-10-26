// Security headers for every response. The CSP lists exactly the external hosts the
// UI uses: ESPN images (headshots, non-local logos), Bluesky / YouTube / Reddit media
// in the social feed, Bluesky HLS video (hls.js fetches playlists + segments, plays via
// blob: MediaSource) and the youtube-nocookie player iframe.
const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https://a.espncdn.com', 'https://cdn.bsky.app', 'https://video.bsky.app',
    'https://i.ytimg.com', 'https://*.ytimg.com', 'https://*.redd.it', 'https://*.redditmedia.com'],
  'media-src': ["'self'", 'blob:', 'https://video.bsky.app'],
  'connect-src': ["'self'", 'https://video.bsky.app'],
  'frame-src': ['https://www.youtube-nocookie.com'],
  'font-src': ["'self'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"]
};

const buildCsp = ({ upgradeInsecure = false } = {}) => Object.entries(CSP_DIRECTIVES)
  .map(([name, values]) => `${name} ${values.join(' ')}`)
  .concat(upgradeInsecure ? ['upgrade-insecure-requests'] : [])
  .join('; ');

const securityHeaders = ({ production = process.env.NODE_ENV === 'production' } = {}) => {
  const csp = buildCsp({ upgradeInsecure: production });
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
      'Cross-Origin-Opener-Policy': 'same-origin'
    });
    next();
  };
};

module.exports = { securityHeaders, buildCsp, CSP_DIRECTIVES };
