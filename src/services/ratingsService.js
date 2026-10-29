// AFI v3 base Elo ratings and model accuracy, both produced by the Python pipeline
// (scripts/model/v3). Node only stores and serves them, like the v2 prediction artifact.
const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const RATINGS_KEY = 'model_ratings_current';
const RATINGS_FILE = path.join(__dirname, '../../scripts/model/v3/ratings_current.json');
const BACKTEST_FILE = path.join(__dirname, '../../scripts/model/v3/backtest_v3.json');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; } };

// Newest of the published (DB) and bundled (disk) artifacts.
const getRatings = async () => {
  const row = await db.loadDataset(RATINGS_KEY).catch(() => null);
  const candidates = [row?.data, readJson(RATINGS_FILE)].filter((a) => a?.teams?.length);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))[0];
};

const saveRatings = async (artifact) => {
  if (!artifact || !/^v3\./.test(artifact.model_version || '') || !Array.isArray(artifact.teams) || !artifact.teams.length) {
    throw Object.assign(new Error('Expected v3 ratings artifact with teams[]'), { status: 400 });
  }
  await db.saveDataset(RATINGS_KEY, artifact, { model_version: artifact.model_version, generated_at: artifact.generated_at, teams: artifact.teams.length });
  return { model_version: artifact.model_version, teams: artifact.teams.length, week: artifact.week };
};

// Walk-forward backtest vs Vegas (offline) plus the live, graded AFI Picks record.
const LABELS = { v2: 'AFI v2 (live picks)', core_v31: 'AFI v3 (no odds)', 'B_m1.0_early-0.2': 'AFI v3 + market line', vegas: 'Vegas closing line' };
const getAccuracy = async () => {
  const b = readJson(BACKTEST_FILE);
  if (!b) return null;
  const rows = Object.entries(LABELS).filter(([k]) => b.results[k]).map(([key, label]) => ({ key, label, ...b.results[key] }));
  const buckets = Object.fromEntries(Object.entries(b.confidence_buckets || {}).filter(([k]) => LABELS[k]).map(([k, v]) => [k, v]));
  let live = null;
  try {
    const picks = await require('./picksService').getPicks();
    live = { record: picks.record, tracking_since: picks.tracking_since, season: picks.season };
  } catch { live = null; }
  return { generated_at: b.generated_at, seasons: b.seasons, games: b.oos_games, models: rows, labels: LABELS, confidence_buckets: buckets, live };
};

module.exports = { getRatings, saveRatings, getAccuracy, RATINGS_KEY };
