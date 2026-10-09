// Player profiles for the trades and free-agent pages: identity (nflverse players.csv: ESPN id,
// birth date, headshot) plus 2025/2026 regular-season stats and snap counts, keyed several ways
// so ESPN transaction text ("Traded G Cam Jurgens") can be resolved to a real player.

const { assetUrl, streamCsv, num } = require('./nflverseService');

const SEASONS = [2025, 2026];
const TTL_MS = 6 * 3600e3;

const STAT_COLS = ['player_id', 'games', 'attempts', 'completions', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered',
  'passing_epa', 'carries', 'rushing_yards', 'rushing_tds', 'rushing_epa', 'receptions', 'targets', 'receiving_yards', 'receiving_tds',
  'def_tackles_solo', 'def_tackle_assists', 'def_tackles_for_loss', 'def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended',
  'fg_made', 'fg_att', 'pt_att', 'pt_net_yards'];

// "Cam Jurgens", "Joey Porter Jr." and "Joey Porter" all normalize to the same key.
const normName = (s) => String(s || '').toLowerCase().replace(/[’'.]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// Position group used for positional value, team needs and production metrics.
const GROUP = {
  QB: 'QB', RB: 'RB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  OT: 'OT', T: 'OT', G: 'IOL', OG: 'IOL', C: 'IOL', OL: 'IOL', IOL: 'IOL',
  DE: 'EDGE', EDGE: 'EDGE', OLB: 'EDGE', DT: 'IDL', NT: 'IDL', DL: 'IDL', IDL: 'IDL',
  LB: 'LB', ILB: 'LB', MLB: 'LB', CB: 'CB', DB: 'CB', S: 'S', FS: 'S', SS: 'S', SAF: 'S',
  K: 'K', PK: 'K', P: 'P', LS: 'LS'
};
const groupOf = (pos) => GROUP[String(pos || '').toUpperCase()] || null;

// AFI positional value (share of a QB's value), roughly following positional market salaries.
const POS_VALUE = { QB: 1, EDGE: 0.8, OT: 0.75, WR: 0.72, CB: 0.7, IDL: 0.62, S: 0.55, TE: 0.52, IOL: 0.5, LB: 0.5, RB: 0.45, K: 0.2, P: 0.18, LS: 0.08 };

const ageOn = (birth, at = new Date()) => {
  if (!birth) return null;
  const b = new Date(`${birth}T12:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  let age = at.getUTCFullYear() - b.getUTCFullYear();
  if (at.getUTCMonth() < b.getUTCMonth() || (at.getUTCMonth() === b.getUTCMonth() && at.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
};

const build = async () => {
  const byGsis = {};
  const byPfr = {};
  const byEspn = {};
  const byName = {};
  await streamCsv(assetUrl('players', 'players.csv'), (r) => {
    if (!r.last_season || Number(r.last_season) < 2024) return;
    const p = {
      gsis_id: r.gsis_id || null, pfr_id: r.pfr_id || null, espn_id: r.espn_id || null, name: r.display_name,
      position: r.position, group: groupOf(r.position) || groupOf(r.position_group), birth_date: r.birth_date || null,
      headshot: r.espn_id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${r.espn_id}.png` : (r.headshot || null),
      latest_team: r.latest_team || null, status: r.status || null, last_season: Number(r.last_season), seasons: {}
    };
    if (p.gsis_id) byGsis[p.gsis_id] = p;
    if (p.pfr_id) byPfr[p.pfr_id] = p;
    if (p.espn_id) byEspn[p.espn_id] = p;
    (byName[normName(p.name)] ||= []).push(p);
  }, { columns: ['gsis_id', 'pfr_id', 'espn_id', 'display_name', 'position', 'position_group', 'birth_date', 'headshot', 'latest_team', 'status', 'last_season'] });

  const dataThrough = {};
  for (const season of SEASONS) {
    await streamCsv(assetUrl('stats_player', `stats_player_reg_${season}.csv`), (r) => {
      const p = byGsis[r.player_id];
      if (!p) return;
      const s = (p.seasons[season] ||= {});
      for (const c of STAT_COLS.slice(1)) s[c] = num(r[c]) || 0;
    }, { columns: STAT_COLS }).catch(() => null);
    let maxWeek = 0;
    await streamCsv(assetUrl('snap_counts', `snap_counts_${season}.csv`), (r) => {
      if (r.game_type !== 'REG') return;
      const p = byPfr[r.pfr_player_id];
      if (!p) return;
      maxWeek = Math.max(maxWeek, Number(r.week) || 0);
      const s = (p.seasons[season] ||= {});
      const off = num(r.offense_snaps) || 0;
      const def = num(r.defense_snaps) || 0;
      s.snap_games = (s.snap_games || 0) + 1;
      s.off_snaps = (s.off_snaps || 0) + off;
      s.def_snaps = (s.def_snaps || 0) + def;
      s.st_snaps = (s.st_snaps || 0) + (num(r.st_snaps) || 0);
      // Share of the unit's snaps in games he played (offense or defense, whichever is his side).
      s.pct_sum = (s.pct_sum || 0) + Math.max(num(r.offense_pct) || 0, num(r.defense_pct) || 0);
      s.last_team = r.team;
      s.last_week = Math.max(s.last_week || 0, Number(r.week) || 0);
    }, { columns: ['game_type', 'week', 'pfr_player_id', 'team', 'offense_snaps', 'offense_pct', 'defense_snaps', 'defense_pct', 'st_snaps'] }).catch(() => null);
    dataThrough[season] = maxWeek || null;
  }
  return { byGsis, byPfr, byEspn, byName, dataThrough, loadedAt: Date.now() };
};

let memo = null;
let loading = null;
const loadProfiles = async () => {
  if (memo && Date.now() - memo.loadedAt < TTL_MS) return memo;
  if (!loading) loading = build().then((m) => { memo = m; return m; }).finally(() => { loading = null; });
  return loading;
};

// Best match for a name from transaction text; position / team hints break ties between namesakes.
const findByName = (profiles, name, { position = null, team = null } = {}) => {
  const list = profiles.byName[normName(name)] || [];
  if (list.length <= 1) return list[0] || null;
  const g = groupOf(position);
  const score = (p) => (g && p.group === g ? 2 : 0) + (team && p.latest_team === team ? 1 : 0) + p.last_season / 10000;
  return [...list].sort((a, b) => score(b) - score(a))[0];
};

const snapsOf = (s = {}) => (s.off_snaps || 0) + (s.def_snaps || 0);
const snapShare = (s = {}) => (s.snap_games ? Math.round(s.pct_sum / s.snap_games * 100) : null);

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

// Compact, human-readable stat line for a season ("2,104 pass yds, 14 TD, 6 INT, +0.08 EPA/play").
const keyStats = (p, season) => {
  const s = p.seasons[season];
  if (!s) return null;
  const parts = [];
  const g = p.group;
  if (s.snap_games) parts.push(`${s.snap_games} G`, `${snapsOf(s)} snaps (${snapShare(s)}%)`);
  else if (s.games) parts.push(`${s.games} G`);
  if (g === 'QB' && s.attempts) {
    const plays = s.attempts + (s.carries || 0) + (s.sacks_suffered || 0);
    parts.push(`${s.completions}/${s.attempts}`, `${s.passing_yards} yds`, `${s.passing_tds} TD`, `${s.passing_interceptions} INT`,
      `${((s.passing_epa + (s.rushing_epa || 0)) / plays >= 0 ? '+' : '')}${r2((s.passing_epa + (s.rushing_epa || 0)) / plays)} EPA/play`);
  } else if (['RB', 'WR', 'TE'].includes(g)) {
    if (s.carries) parts.push(`${s.carries} car, ${s.rushing_yards} rush yds`);
    if (s.targets) parts.push(`${s.receptions}/${s.targets} rec, ${s.receiving_yards} yds (${r1(s.receiving_yards / s.targets)} Y/T)`);
    const td = (s.rushing_tds || 0) + (s.receiving_tds || 0);
    if (td) parts.push(`${td} TD`);
  } else if (['EDGE', 'IDL', 'LB', 'CB', 'S'].includes(g)) {
    const tk = (s.def_tackles_solo || 0) + (s.def_tackle_assists || 0);
    if (tk) parts.push(`${tk} tkl`);
    if (s.def_sacks) parts.push(`${s.def_sacks} sk`);
    if (s.def_qb_hits) parts.push(`${s.def_qb_hits} QB hits`);
    if (s.def_pass_defended) parts.push(`${s.def_pass_defended} PD`);
    if (s.def_interceptions) parts.push(`${s.def_interceptions} INT`);
  } else if (g === 'K' && s.fg_att) parts.push(`${s.fg_made}/${s.fg_att} FG`);
  else if (g === 'P' && s.pt_att) parts.push(`${s.pt_att} punts, ${r1(s.pt_net_yards / s.pt_att)} net`);
  return parts.length ? parts.join(', ') : null;
};

module.exports = { loadProfiles, findByName, normName, groupOf, ageOn, keyStats, snapsOf, snapShare, POS_VALUE, SEASONS };
