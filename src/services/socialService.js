const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const db = require('../db/database');
const accounts = require('../config/socialAccounts');

// Social feed: public posts from Bluesky, YouTube and (with keys) Reddit, kept in their own store and
// shown in full with a link to the original. Separate from news (no clustering, no LLM).
// Each platform refreshes on its own schedule (see jobs/scheduler.js) and records its own health.

const DATASET = 'social_v1';
const KEEP_DAYS = { bluesky: 7, youtube: 7, reddit: 3 };
const MAX_POSTS = 2500;
const FAILURE_LIMIT = 3; // consecutive failures before an account is parked
const PARK_RETRY_MS = 3600e3; // parked accounts are retried once an hour
const BREAKING_MS = 30 * 60e3;
const BREAKING_RE = /\b(trad(?:e|ed|es|ing)|sign(?:s|ed|ing)|injur(?:y|ies|ed)|out|released?|releasing|agree[sd]?|agreement)\b/i;

const BLUESKY_API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed';
const YOUTUBE_RSS = 'https://www.youtube.com/feeds/videos.xml';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_API = 'https://oauth.reddit.com';
const REDDIT_UA = `web:american-football-insider:v1.0 (by /u/${process.env.REDDIT_USERNAME || 'american-football-insider'})`;

const http = axios.create({ timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; American-Football-Insider/1.0; +https://american-football-insider.fly.dev)' } });
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
const errorText = (error) => (error.response ? `HTTP ${error.response.status}` : error.message);

// --- Bluesky -------------------------------------------------------------------------

// Link facets index UTF-8 bytes; the visible text of a link is often shortened ("nfl.com/news/…"),
// so the client renders these segments with the full target URL.
const blueskySegments = (text, facets = []) => {
  const links = facets
    .map((f) => ({ start: f.index?.byteStart, end: f.index?.byteEnd, href: (f.features || []).find((x) => x.$type === 'app.bsky.richtext.facet#link')?.uri }))
    .filter((l) => l.href && Number.isInteger(l.start) && Number.isInteger(l.end) && l.end > l.start)
    .sort((a, b) => a.start - b.start);
  if (!links.length) return null;
  const bytes = Buffer.from(text, 'utf8');
  const segments = [];
  let at = 0;
  links.forEach((l) => {
    if (l.start < at || l.end > bytes.length) return;
    if (l.start > at) segments.push({ text: bytes.slice(at, l.start).toString('utf8') });
    segments.push({ text: bytes.slice(l.start, l.end).toString('utf8'), href: l.href });
    at = l.end;
  });
  if (at < bytes.length) segments.push({ text: bytes.slice(at).toString('utf8') });
  return segments;
};

const blueskyMedia = (embed) => {
  if (!embed) return null;
  const e = embed.$type === 'app.bsky.embed.recordWithMedia#view' ? embed.media : embed;
  if (e?.$type === 'app.bsky.embed.images#view' && e.images?.length) {
    return { type: 'image', thumb: e.images[0].thumb, full: e.images[0].fullsize, alt: e.images[0].alt || '', count: e.images.length };
  }
  if (e?.$type === 'app.bsky.embed.video#view') return { type: 'video', thumb: e.thumbnail || null, playlist: e.playlist || null, aspect: e.aspectRatio || null };
  if (e?.$type === 'app.bsky.embed.external#view' && e.external?.uri) {
    return { type: 'link', url: e.external.uri, title: e.external.title || '', description: clip(e.external.description || '', 200), thumb: e.external.thumb || null };
  }
  return null;
};

// One author feed -> social posts. Reposts are skipped: they would duplicate the original author's post.
const fetchBluesky = async (account) => {
  const { data } = await http.get(BLUESKY_API, { params: { actor: account.handle, limit: 30, filter: 'posts_no_replies' } });
  return (data.feed || []).filter((f) => !f.reason && f.post?.record?.text).map(({ post }) => {
    const rkey = String(post.uri || '').split('/').pop();
    const handle = post.author?.handle || account.handle;
    return {
      id: `bsky-${rkey}`,
      platform: 'bluesky',
      account: account.handle,
      author: { name: post.author?.displayName || account.name || handle, handle: `@${handle}`, avatar: post.author?.avatar || null, url: `https://bsky.app/profile/${handle}` },
      text: post.record.text,
      segments: blueskySegments(post.record.text, post.record.facets),
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      published: post.record.createdAt || post.indexedAt,
      media: blueskyMedia(post.embed),
      metrics: { likes: post.likeCount || 0, reposts: post.repostCount || 0, replies: post.replyCount || 0 },
      insider: !!account.insider,
      account_team: account.team || null
    };
  });
};

// --- YouTube -------------------------------------------------------------------------

const fetchYoutube = async (channel) => {
  const { data } = await http.get(YOUTUBE_RSS, { params: { channel_id: channel.channel_id }, responseType: 'text' });
  const feed = xml.parse(data)?.feed;
  if (!feed) throw new Error('not a YouTube feed');
  return [].concat(feed.entry || []).map((e) => {
    const videoId = e['yt:videoId'];
    const group = e['media:group'] || {};
    const href = [].concat(e.link || [])[0]?.href || `https://www.youtube.com/watch?v=${videoId}`;
    const title = decode(e.title?.['#text'] ?? e.title);
    return {
      id: `yt-${videoId}`,
      platform: 'youtube',
      account: channel.channel_id,
      author: { name: e.author?.name || channel.name, handle: channel.name, avatar: null, url: `https://www.youtube.com/channel/${channel.channel_id}` },
      text: title,
      segments: null,
      url: href,
      published: e.published,
      media: { type: 'youtube', video_id: videoId, short: /\/shorts\//.test(href), thumb: group['media:thumbnail']?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` },
      metrics: { views: Number(group['media:community']?.['media:statistics']?.views || 0) },
      insider: false,
      account_team: channel.team || null
    };
  }).filter((p) => p.media.video_id && p.published);
};

// --- Reddit (OAuth app-only; disabled without keys) -----------------------------------

const redditConfigured = () => Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
let redditToken = null;

const redditAuth = async () => {
  if (redditToken && redditToken.expires > Date.now() + 60e3) return redditToken.value;
  const { data } = await http.post(REDDIT_TOKEN_URL, 'grant_type=client_credentials', {
    auth: { username: process.env.REDDIT_CLIENT_ID, password: process.env.REDDIT_CLIENT_SECRET },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': REDDIT_UA }
  });
  if (!data.access_token) throw new Error(data.error || 'no access_token');
  redditToken = { value: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return redditToken.value;
};

const fetchReddit = async (sub) => {
  const token = await redditAuth();
  const { data } = await http.get(`${REDDIT_API}/r/${sub.subreddit}/${sub.listing || 'hot'}`, {
    params: { limit: sub.limit || 30, raw_json: 1 },
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': REDDIT_UA }
  });
  return (data?.data?.children || []).map((c) => c.data).filter((p) => p && !p.over_18 && !p.stickied).map((p) => {
    const preview = p.preview?.images?.[0]?.resolutions?.slice(-1)[0]?.url || p.preview?.images?.[0]?.source?.url;
    const thumb = preview || (/^https?:/.test(p.thumbnail || '') ? p.thumbnail : null);
    const external = p.is_self ? null : p.url_overridden_by_dest || p.url;
    return {
      id: `rd-${p.id}`,
      platform: 'reddit',
      account: `r/${sub.subreddit}`,
      author: { name: `r/${p.subreddit || sub.subreddit}`, handle: `u/${p.author}`, avatar: null, url: `https://www.reddit.com/r/${p.subreddit || sub.subreddit}` },
      text: decode(p.title),
      body: p.selftext ? clip(decode(p.selftext), 400) : null,
      segments: null,
      url: `https://www.reddit.com${p.permalink}`,
      published: new Date(p.created_utc * 1000).toISOString(),
      media: thumb || external ? { type: thumb ? 'image' : 'link', thumb: thumb ? decode(thumb) : null, url: external } : null,
      flair: p.link_flair_text || null,
      metrics: { score: p.score || 0, comments: p.num_comments || 0 },
      insider: false,
      account_team: null
    };
  });
};

// --- Store ---------------------------------------------------------------------------

let memo = null;
const load = async () => {
  if (memo) return memo;
  const row = await db.loadDataset(DATASET).catch(() => null);
  memo = row?.data || { posts: {}, sources: {} };
  memo.posts ||= {};
  memo.sources ||= {};
  return memo;
};

// Team tags from the post text (team names + rostered player names) via the news tagger.
// The index needs 32 rosters, so it is rebuilt at most hourly.
let tagIndex = null;
const getIndex = async () => {
  if (tagIndex && tagIndex.at > Date.now() - 3600e3) return tagIndex.index;
  const { buildIndex } = require('./newsService');
  tagIndex = { index: await buildIndex(), at: Date.now() };
  return tagIndex.index;
};

const tagTeams = (post, index) => {
  const teams = new Set(post.account_team ? [post.account_team] : []);
  if (index) {
    const { tagItem } = require('./newsService');
    const text = [post.text, post.body, post.media?.title].filter(Boolean).join(' ');
    tagItem({ title: '', description: text, espn_team_ids: [], espn_athletes: [] }, index).teams.forEach((t) => teams.add(t));
  }
  return [...teams];
};

const accountKey = (platform, a) => (platform === 'bluesky' ? a.handle : platform === 'youtube' ? a.channel_id : `r/${a.subreddit}`);

// Runs one platform: fetch every active account, merge posts, record per-account health, save.
const runPlatform = async (platform, list, fetcher) => {
  const state = await load();
  const src = state.sources[platform] ||= { accounts: {} };
  src.accounts ||= {};
  const started = new Date().toISOString();
  src.last_run = started;
  const enabled = list.filter((a) => a.enabled !== false);
  const due = enabled.filter((a) => {
    const h = src.accounts[accountKey(platform, a)];
    return !h || h.failures < FAILURE_LIMIT || Date.now() - Date.parse(h.last_error_at || 0) >= PARK_RETRY_MS;
  });
  let index = null;
  try { index = await getIndex(); } catch (error) { console.warn('[social] team tagging unavailable:', error.message); }
  let fetched = 0;
  let added = 0;
  const errors = [];
  await Promise.all(due.map(async (a) => {
    const key = accountKey(platform, a);
    const prior = src.accounts[key] || {};
    try {
      const posts = await fetcher(a);
      fetched += posts.length;
      posts.forEach((p) => {
        const t = Date.parse(p.published);
        if (Number.isNaN(t)) return;
        p.published = new Date(t).toISOString();
        p.teams = tagTeams(p, index);
        delete p.account_team;
        const existing = state.posts[p.id];
        if (!existing) added += 1;
        state.posts[p.id] = { ...p, first_seen: existing?.first_seen || started };
      });
      src.accounts[key] = { name: a.name, failures: 0, last_success: new Date().toISOString(), last_error: prior.last_error || null, last_error_at: prior.last_error_at || null, posts: posts.length, latest_post: posts.map((p) => p.published).sort().pop() || prior.latest_post || null };
    } catch (error) {
      const failures = Number(prior.failures || 0) + 1;
      src.accounts[key] = { ...prior, name: a.name, failures, last_error: errorText(error), last_error_at: new Date().toISOString() };
      errors.push(`${a.name || key}: ${errorText(error)}`);
      if (failures === FAILURE_LIMIT) console.warn(`[social] parking ${platform} ${key} after ${failures} consecutive failures`);
    }
  }));
  // Accounts removed from the config drop out of the health view.
  const keys = new Set(list.map((a) => accountKey(platform, a)));
  Object.keys(src.accounts).forEach((k) => { if (!keys.has(k)) delete src.accounts[k]; });

  const now = new Date().toISOString();
  if (due.length && errors.length === due.length) {
    src.last_error = errors[0];
    src.last_error_at = now;
    src.failures = Number(src.failures || 0) + 1;
  } else {
    src.last_success = now;
    src.failures = 0;
    if (errors.length) { src.last_error = errors.join('; '); src.last_error_at = now; }
  }
  src.fetched = fetched;
  src.new_posts = added;

  // Retention: per-platform age, then a global cap (oldest first).
  Object.entries(state.posts).forEach(([id, p]) => {
    if (Date.parse(p.published) < Date.now() - (KEEP_DAYS[p.platform] || 7) * 864e5) delete state.posts[id];
  });
  const ids = Object.keys(state.posts);
  if (ids.length > MAX_POSTS) ids.sort((a, b) => state.posts[a].published.localeCompare(state.posts[b].published)).slice(0, ids.length - MAX_POSTS).forEach((id) => delete state.posts[id]);
  state.updated_at = now;
  await db.saveDataset(DATASET, state, { posts: Object.keys(state.posts).length });
  console.log(`[social] ${platform}: ${due.length}/${enabled.length} accounts, ${fetched} posts fetched, ${added} new${errors.length ? `, ${errors.length} failed` : ''}`);
  if (due.length && errors.length === due.length) throw new Error(`all ${platform} accounts failed: ${errors[0]}`);
  return { accounts: due.length - errors.length, new_posts: added, error: errors.length ? errors.join('; ') : undefined };
};

// Jobs run one at a time against the shared in-memory store.
let chain = Promise.resolve();
const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

const runBluesky = () => serial(() => runPlatform('bluesky', accounts.bluesky, fetchBluesky));
const runYoutube = () => serial(() => runPlatform('youtube', accounts.youtube, fetchYoutube));
const runReddit = () => {
  if (!redditConfigured()) return Promise.resolve({ skipped: 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set' });
  return serial(() => runPlatform('reddit', accounts.reddit, fetchReddit));
};

// --- Read API ------------------------------------------------------------------------

const isBreaking = (p, now = Date.now()) => p.insider && now - Date.parse(p.published) <= BREAKING_MS && (BREAKING_RE.test(p.text) || /\bIR\b/.test(p.text));

const list = async ({ platform = null, account = null, team = null, limit = 50 } = {}) => {
  const state = await load();
  const platforms = platform ? String(platform).toLowerCase().split(',') : null;
  const teams = team ? String(team).toUpperCase().split(',').filter(Boolean) : null;
  const now = Date.now();
  const posts = Object.values(state.posts)
    .filter((p) => (!platforms || platforms.includes(p.platform)) && (!account || p.account === account) && (!teams || p.teams.some((t) => teams.includes(t))))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, limit)
    .map((p) => ({ ...p, breaking: isBreaking(p, now) }));
  return { posts, accounts: accountList(), platforms: platformList(), last_updated: state.updated_at || null };
};

const accountList = () => [
  ...accounts.bluesky.filter((a) => a.enabled !== false).map((a) => ({ platform: 'bluesky', account: a.handle, name: a.name, team: a.team || null })),
  ...accounts.youtube.map((a) => ({ platform: 'youtube', account: a.channel_id, name: a.name, team: a.team || null })),
  ...(redditConfigured() ? accounts.reddit.map((a) => ({ platform: 'reddit', account: `r/${a.subreddit}`, name: `r/${a.subreddit}`, team: null })) : [])
];

const platformList = () => [
  { platform: 'bluesky', label: 'Bluesky', enabled: true },
  { platform: 'youtube', label: 'YouTube', enabled: true },
  { platform: 'reddit', label: 'Reddit', enabled: redditConfigured() }
];

const status = async () => {
  const state = await load();
  const count = (platform) => Object.values(state.posts).filter((p) => p.platform === platform).length;
  const describe = (platform, list) => {
    const src = state.sources[platform] || { accounts: {} };
    const health = list.map((a) => {
      const key = accountKey(platform, a);
      const h = src.accounts?.[key] || {};
      const parked = Number(h.failures || 0) >= FAILURE_LIMIT;
      return { account: key, name: a.name, state: a.enabled === false ? 'disabled' : parked ? 'parked' : h.last_success ? 'ok' : 'pending', failures: h.failures || 0, last_success: h.last_success || null, latest_post: h.latest_post || null, last_error: h.last_error || null, last_error_at: h.last_error_at || null };
    });
    return {
      last_run: src.last_run || null,
      last_success: src.last_success || null,
      last_error: src.last_error || null,
      last_error_at: src.last_error_at || null,
      failures: src.failures || 0,
      active_accounts: health.filter((h) => h.state === 'ok').length,
      configured_accounts: list.length,
      posts: count(platform),
      accounts: health
    };
  };
  return {
    bluesky: describe('bluesky', accounts.bluesky),
    youtube: describe('youtube', accounts.youtube),
    reddit: { enabled: redditConfigured(), ...(redditConfigured() ? describe('reddit', accounts.reddit) : { note: 'Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to enable.' }) },
    mastodon: { enabled: false, note: 'Skipped: only unofficial X-mirror bots post NFL content on Mastodon.' },
    x: { enabled: false, note: 'No free X/Twitter API.' },
    posts: Object.keys(state.posts).length,
    last_updated: state.updated_at || null
  };
};

module.exports = { runBluesky, runYoutube, runReddit, list, status, redditConfigured, fetchBluesky, fetchYoutube, fetchReddit, blueskySegments, isBreaking, DATASET };
