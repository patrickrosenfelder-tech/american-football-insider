const zlib = require('zlib');
const axios = require('axios');
const { parse } = require('csv-parse');

// nflverse publishes free NFL data as GitHub release assets:
// https://github.com/nflverse/nflverse-data/releases
const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';
const RELEASES_API = 'https://api.github.com/repos/nflverse/nflverse-data/releases/tags';

const assetUrl = (tag, file) => `${RELEASES}/${tag}/${file}`;

// Streams a CSV (optionally .gz) and calls onRow for each record, keeping only `columns`
// so large files (pbp has ~370 columns) don't sit in memory.
const streamCsv = async (url, onRow, { columns = null } = {}) => {
  const res = await axios.get(url, {
    responseType: 'stream',
    timeout: 120000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'American-Football-Insider/1.0' }
  });
  const source = url.endsWith('.gz') ? res.data.pipe(zlib.createGunzip()) : res.data;
  const parser = source.pipe(parse({ columns: true, relax_column_count: true }));
  let count = 0;
  for await (const record of parser) {
    if (columns) {
      const slim = {};
      for (const c of columns) slim[c] = record[c];
      onRow(slim);
    } else {
      onRow(record);
    }
    count += 1;
  }
  return count;
};

// Returns asset names for a release tag (used to detect whether a season file exists yet).
const listAssets = async (tag) => {
  const { data } = await axios.get(`${RELEASES_API}/${tag}`, {
    timeout: 15000,
    headers: { 'User-Agent': 'American-Football-Insider/1.0', Accept: 'application/vnd.github+json' }
  });
  return (data.assets || []).map((a) => ({ name: a.name, updated_at: a.updated_at }));
};

const assetExists = async (tag, file) => {
  try {
    const assets = await listAssets(tag);
    return assets.find((a) => a.name === file) || null;
  } catch (error) {
    // GitHub API rate limits unauthenticated calls; fall back to a HEAD request on the asset.
    try {
      await axios.head(assetUrl(tag, file), { maxRedirects: 5, timeout: 15000 });
      return { name: file, updated_at: null };
    } catch {
      return null;
    }
  }
};

const num = (v) => {
  if (v === undefined || v === null || v === '' || v === 'NA') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const bool = (v) => v === 'TRUE' || v === 'true' || v === '1' || v === 1 || v === true;

// gsis_id / pfr_id -> ESPN athlete id, from nflverse's players.csv. Memoized for 12h.
let idMapMemo = null;
const loadIdMap = async () => {
  if (idMapMemo && Date.now() - idMapMemo.loadedAt < 12 * 3600 * 1000) return idMapMemo;
  const map = { gsis: {}, pfr: {}, loadedAt: Date.now() };
  await streamCsv(assetUrl('players', 'players.csv'), (r) => {
    if (!r.espn_id) return;
    if (r.gsis_id) map.gsis[r.gsis_id] = r;
    if (r.pfr_id) map.pfr[r.pfr_id] = r;
  }, { columns: ['gsis_id', 'pfr_id', 'espn_id', 'display_name', 'position'] });
  idMapMemo = map;
  return map;
};

module.exports = {
  assetUrl,
  loadIdMap,
  streamCsv,
  listAssets,
  assetExists,
  num,
  bool
};
