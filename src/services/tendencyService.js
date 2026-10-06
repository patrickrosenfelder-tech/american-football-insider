const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { assetUrl, streamCsv, assetExists, num, bool } = require('./nflverseService');
const { loadPbp, toEspn } = require('./teamStatsService');

// Scheme tendencies per team, season-to-date and last 3 games, from nflverse:
//  - play_by_play_<season>   : pass/run, shotgun, no-huddle, pace, EPA (always available, nightly)
//  - ftn_charting_<season>   : QB alignment (shotgun/under center/pistol), backfield count, motion,
//                              play action, RPO, screens, box count, blitzers, pass rushers
//  - pbp_participation_<season>: offense/defense personnel, man vs zone, coverage shell. nflverse
//                              publishes this file only after the season ends, so for the live season
//                              these fields come from the latest season that has it (labelled).

const REFERENCE_DIR = path.join(__dirname, '../data');
const referencePath = (season) => path.join(REFERENCE_DIR, `tendencies_${season}.json`);

const FTN_COLUMNS = ['nflverse_game_id', 'nflverse_play_id', 'week', 'qb_location', 'n_offense_backfield', 'n_defense_box',
  'is_no_huddle', 'is_motion', 'is_play_action', 'is_screen_pass', 'is_rpo', 'n_blitzers', 'n_pass_rushers'];
const PARTICIPATION_COLUMNS = ['nflverse_game_id', 'play_id', 'offense_formation', 'offense_personnel', 'defense_personnel',
  'defenders_in_box', 'number_of_pass_rushers', 'defense_man_zone_type', 'defense_coverage_type'];

// "1 RB, 1 TE, 3 WR" (+ OL/QB) -> "11" ; null for special teams / unusual groupings.
const offensePersonnelGroup = (s) => {
  if (!s) return null;
  const counts = {};
  s.split(',').forEach((part) => {
    const [n, pos] = part.trim().split(/\s+/);
    counts[pos] = (counts[pos] || 0) + Number(n);
  });
  if (counts.K || counts.P || counts.LS) return null;
  const backs = (counts.RB || 0) + (counts.FB || 0);
  const tes = counts.TE || 0;
  if (backs > 9 || tes > 9) return null;
  return `${backs}${tes}`;
};

// "3 CB, 2 DE, 2 DT, 1 FS, 1 MLB, 1 OLB, 1 SS" -> { dbs: 5, dl: 4, lb: 2 }
const defenseCounts = (s) => {
  if (!s) return null;
  const counts = { dbs: 0, dl: 0, lb: 0, other: 0 };
  s.split(',').forEach((part) => {
    const [n, pos] = part.trim().split(/\s+/);
    const k = Number(n);
    if (['CB', 'FS', 'SS', 'S', 'DB'].includes(pos)) counts.dbs += k;
    else if (['DE', 'DT', 'NT', 'DL'].includes(pos)) counts.dl += k;
    else if (['LB', 'ILB', 'OLB', 'MLB'].includes(pos)) counts.lb += k;
    else counts.other += k;
  });
  if (counts.other) return null; // special teams / offensive players on defense
  return counts;
};

const defensivePackage = (c) => {
  if (!c) return null;
  if (c.dbs <= 4) return 'Base (4 DB)';
  if (c.dbs === 5) return 'Nickel (5 DB)';
  if (c.dbs === 6) return 'Dime (6 DB)';
  return 'Quarter+ (7+ DB)';
};

const COVERAGE_LABELS = {
  COVER_0: 'Cover 0', COVER_1: 'Cover 1', COVER_2: 'Cover 2', '2_MAN': '2-Man', COVER_3: 'Cover 3', COVER_4: 'Cover 4 (Quarters)',
  COVER_6: 'Cover 6', COVER_9: 'Cover 9', COMBO: 'Combo', BLOWN: 'Blown', PREVENT: 'Prevent'
};

// --- Accumulators -----------------------------------------------------------

const counter = () => ({ n: 0, by: {} });
const bump = (c, key, extra) => {
  c.n += 1;
  const slot = c.by[key] || (c.by[key] = { n: 0, pass: 0, epa: 0, epa_n: 0 });
  slot.n += 1;
  if (extra) {
    slot.pass += extra.pass ? 1 : 0;
    if (extra.epa != null) { slot.epa += extra.epa; slot.epa_n += 1; }
  }
};

const newOffense = () => ({
  plays: 0, pass: 0, rush: 0, dropbacks: 0, epa: 0, epa_n: 0, success: 0,
  pass_epa: 0, pass_epa_n: 0, rush_epa: 0, rush_epa_n: 0,
  neutral: 0, neutral_pass: 0,
  shotgun: 0, no_huddle: 0,
  pace_sum: 0, pace_n: 0,
  ftn: 0, ftn_dropbacks: 0, motion: 0, play_action: 0, screen: 0, rpo: 0,
  qb_location: counter(), backfield: counter(),
  personnel: counter(), part_plays: 0, formation: counter()
});

const newDefense = () => ({
  plays: 0, pass: 0, epa: 0, epa_n: 0, success: 0,
  ftn: 0, box_sum: 0, box_n: 0, box8: 0, ftn_dropbacks: 0, blitz: 0, rushers_sum: 0, rushers_n: 0,
  part_plays: 0, package: counter(), dl_on_base: counter(), mz: counter(), shell: counter(),
  part_box_sum: 0, part_box_n: 0, part_rushers_sum: 0, part_rushers_n: 0
});

const r1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 1000) / 1000);
const pct = (a, b) => (b ? r1((100 * a) / b) : null);

const shares = (c, labels = {}, { withPass = false, min = 0 } = {}) => Object.entries(c.by)
  .map(([k, v]) => ({
    key: k,
    label: labels[k] || k,
    plays: v.n,
    pct: pct(v.n, c.n),
    ...(withPass ? { pass_rate: pct(v.pass, v.n), epa_per_play: v.epa_n ? r3(v.epa / v.epa_n) : null } : {})
  }))
  .filter((x) => x.plays >= min)
  .sort((a, b) => b.plays - a.plays);

const finishOffense = (o, hasFtn, hasPart) => ({
  plays: o.plays,
  pass_rate: pct(o.pass, o.plays),
  run_rate: pct(o.rush, o.plays),
  neutral_pass_rate: pct(o.neutral_pass, o.neutral),
  shotgun_rate: pct(o.shotgun, o.plays),
  under_center_rate: o.plays ? r1(100 - (100 * o.shotgun) / o.plays) : null,
  no_huddle_rate: pct(o.no_huddle, o.plays),
  seconds_per_play: o.pace_n ? r1(o.pace_sum / o.pace_n) : null,
  epa_per_play: o.epa_n ? r3(o.epa / o.epa_n) : null,
  success_rate: pct(o.success, o.epa_n),
  pass_epa: o.pass_epa_n ? r3(o.pass_epa / o.pass_epa_n) : null,
  rush_epa: o.rush_epa_n ? r3(o.rush_epa / o.rush_epa_n) : null,
  ftn: hasFtn ? {
    charted_plays: o.ftn,
    qb_alignment: shares(o.qb_location, { S: 'Shotgun', U: 'Under center', P: 'Pistol' }),
    backfield: shares(o.backfield, { 0: 'Empty (0)', 1: '1 back', 2: '2 backs', 3: '3+ backs' }),
    motion_rate: pct(o.motion, o.ftn),
    play_action_rate: pct(o.play_action, o.ftn_dropbacks),
    screen_rate: pct(o.screen, o.ftn_dropbacks),
    rpo_rate: pct(o.rpo, o.ftn)
  } : null,
  personnel: hasPart ? shares(o.personnel, {}, { withPass: true, min: 1 }) : null,
  formation: hasPart ? shares(o.formation, { SHOTGUN: 'Shotgun', 'UNDER CENTER': 'Under center', PISTOL: 'Pistol', EMPTY: 'Empty', JUMBO: 'Jumbo', WILDCAT: 'Wildcat', SINGLEBACK: 'Singleback', 'I_FORM': 'I-formation' }) : null
});

const finishDefense = (d, hasFtn, hasPart) => {
  let derivedFront = null;
  if (hasPart && d.dl_on_base.n >= 20) {
    const dl = Object.entries(d.dl_on_base.by).sort((a, b) => b[1].n - a[1].n)[0][0];
    derivedFront = Number(dl) >= 4 ? '4-3' : '3-4';
  }
  const mz = shares(d.mz, { MAN_COVERAGE: 'Man', ZONE_COVERAGE: 'Zone' });
  return {
    plays: d.plays,
    pass_rate_faced: pct(d.pass, d.plays),
    epa_per_play_allowed: d.epa_n ? r3(d.epa / d.epa_n) : null,
    success_rate_allowed: pct(d.success, d.epa_n),
    ftn: hasFtn ? {
      charted_plays: d.ftn,
      avg_box: d.box_n ? r1(d.box_sum / d.box_n) : null,
      heavy_box_rate: pct(d.box8, d.box_n),
      blitz_rate: pct(d.blitz, d.ftn_dropbacks),
      avg_pass_rushers: d.rushers_n ? r1(d.rushers_sum / d.rushers_n) : null
    } : null,
    participation: hasPart ? {
      plays: d.part_plays,
      derived_base_front: derivedFront,
      packages: shares(d.package),
      man_zone: mz,
      man_rate: mz.find((x) => x.key === 'MAN_COVERAGE')?.pct ?? null,
      zone_rate: mz.find((x) => x.key === 'ZONE_COVERAGE')?.pct ?? null,
      coverage_shells: shares(d.shell, COVERAGE_LABELS),
      avg_box: d.part_box_n ? r1(d.part_box_sum / d.part_box_n) : null,
      avg_pass_rushers: d.part_rushers_n ? r1(d.part_rushers_sum / d.part_rushers_n) : null
    } : null
  };
};

// --- Builder ----------------------------------------------------------------

// includeParticipation=false at runtime: the participation CSV is ~50 MB and only exists for completed
// seasons, which are pre-built into src/data by scripts/build-tendencies.js instead.
const buildTendencies = async (season, { plays = null, includeParticipation = true } = {}) => {
  const ftnFile = `ftn_charting_${season}.csv`;
  const partFile = `pbp_participation_${season}.csv`;
  const [pbp, ftnAsset, partAsset] = await Promise.all([
    plays ? Promise.resolve(plays) : loadPbp(season),
    assetExists('ftn_charting', ftnFile),
    includeParticipation ? assetExists('pbp_participation', partFile) : Promise.resolve(null)
  ]);

  const ftn = new Map();
  let ftnMaxWeek = 0;
  if (ftnAsset) {
    await streamCsv(assetUrl('ftn_charting', ftnFile), (r) => {
      ftn.set(`${r.nflverse_game_id}|${r.nflverse_play_id}`, r);
    }, { columns: FTN_COLUMNS });
  }
  const part = new Map();
  if (partAsset) {
    await streamCsv(assetUrl('pbp_participation', partFile), (r) => {
      part.set(`${r.nflverse_game_id}|${r.play_id}`, r);
    }, { columns: PARTICIPATION_COLUMNS });
  }
  const hasFtn = ftn.size > 0;
  const hasPart = part.size > 0;

  // Last 3 games per team (by week).
  const teamGames = {};
  pbp.forEach((p) => {
    [p.posteam, p.defteam].forEach((t) => {
      if (!t) return;
      (teamGames[t] ||= new Map()).set(p.game_id, Number(p.week));
    });
  });
  const last3 = {};
  Object.entries(teamGames).forEach(([t, games]) => {
    last3[t] = new Set([...games.entries()].sort((a, b) => a[1] - b[1]).slice(-3).map(([g]) => g));
  });

  const acc = {}; // team -> scope -> { off, def }
  const league = { off: newOffense(), def: newDefense() };
  const slot = (team, scope) => {
    const t = acc[team] || (acc[team] = {});
    return t[scope] || (t[scope] = { off: newOffense(), def: newDefense() });
  };

  let prev = null;
  let maxWeek = 0;
  pbp.forEach((p) => {
    const isScrimmage = p.play_type === 'pass' || p.play_type === 'run';
    if (!isScrimmage || !p.posteam || !p.defteam) { prev = null; return; }
    maxWeek = Math.max(maxWeek, Number(p.week) || 0);
    const isPass = p.pass === '1';
    const isRush = p.rush === '1' && !isPass;
    const dropback = p.qb_dropback === '1';
    const epa = num(p.epa);
    const success = num(p.success) || 0;
    const wp = num(p.wp);
    const neutral = wp != null && wp >= 0.2 && wp <= 0.8 && Number(p.qtr) <= 3;
    const gsr = num(p.game_seconds_remaining);
    let pace = null;
    if (prev && prev.game_id === p.game_id && prev.drive === p.drive && prev.qtr === p.qtr && gsr != null && prev.gsr != null) {
      const diff = prev.gsr - gsr;
      if (diff > 0 && diff <= 60) pace = diff;
    }
    prev = { game_id: p.game_id, drive: p.drive, qtr: p.qtr, gsr };

    const f = ftn.get(`${p.game_id}|${p.play_id}`);
    if (f) ftnMaxWeek = Math.max(ftnMaxWeek, Number(p.week) || 0);
    const pp = part.get(`${p.game_id}|${p.play_id}`);

    const scopes = ['season'];
    if (last3[p.posteam]?.has(p.game_id)) scopes.push('last3');
    const addOffense = (o) => {
      o.plays += 1;
      if (isPass) o.pass += 1;
      if (isRush) o.rush += 1;
      if (dropback) o.dropbacks += 1;
      if (epa != null) {
        o.epa += epa; o.epa_n += 1; o.success += success;
        if (isPass) { o.pass_epa += epa; o.pass_epa_n += 1; }
        if (isRush) { o.rush_epa += epa; o.rush_epa_n += 1; }
      }
      if (neutral) { o.neutral += 1; if (isPass) o.neutral_pass += 1; }
      if (p.shotgun === '1') o.shotgun += 1;
      if (p.no_huddle === '1') o.no_huddle += 1;
      if (pace != null) { o.pace_sum += pace; o.pace_n += 1; }
      if (f && f.qb_location && f.qb_location !== '0') {
        o.ftn += 1;
        bump(o.qb_location, f.qb_location);
        const backs = Math.min(3, Number(f.n_offense_backfield) || 0);
        bump(o.backfield, String(backs));
        if (bool(f.is_motion)) o.motion += 1;
        if (bool(f.is_rpo)) o.rpo += 1;
        if (dropback) {
          o.ftn_dropbacks += 1;
          if (bool(f.is_play_action)) o.play_action += 1;
          if (bool(f.is_screen_pass)) o.screen += 1;
        }
      }
      if (pp) {
        const grp = offensePersonnelGroup(pp.offense_personnel);
        if (grp) { o.part_plays += 1; bump(o.personnel, grp, { pass: isPass, epa }); }
        if (pp.offense_formation) bump(o.formation, pp.offense_formation);
      }
    };
    const addDefense = (d) => {
      d.plays += 1;
      if (isPass) d.pass += 1;
      if (epa != null) { d.epa += epa; d.epa_n += 1; d.success += success; }
      if (f && f.qb_location && f.qb_location !== '0') {
        d.ftn += 1;
        const box = num(f.n_defense_box);
        if (box) { d.box_sum += box; d.box_n += 1; if (box >= 8) d.box8 += 1; }
        if (dropback) {
          d.ftn_dropbacks += 1;
          if ((num(f.n_blitzers) || 0) > 0) d.blitz += 1;
          const rushers = num(f.n_pass_rushers);
          if (rushers) { d.rushers_sum += rushers; d.rushers_n += 1; }
        }
      }
      if (pp) {
        const c = defenseCounts(pp.defense_personnel);
        if (c) {
          d.part_plays += 1;
          bump(d.package, defensivePackage(c));
          if (c.dbs === 4) bump(d.dl_on_base, String(c.dl));
        }
        if (pp.defense_man_zone_type) bump(d.mz, pp.defense_man_zone_type);
        if (pp.defense_coverage_type) bump(d.shell, pp.defense_coverage_type);
        const box = num(pp.defenders_in_box);
        if (box) { d.part_box_sum += box; d.part_box_n += 1; }
        const rushers = num(pp.number_of_pass_rushers);
        if (dropback && rushers) { d.part_rushers_sum += rushers; d.part_rushers_n += 1; }
      }
    };

    scopes.forEach((s) => addOffense(slot(p.posteam, s).off));
    const dScopes = ['season'];
    if (last3[p.defteam]?.has(p.game_id)) dScopes.push('last3');
    dScopes.forEach((s) => addDefense(slot(p.defteam, s).def));
    addOffense(league.off);
    addDefense(league.def);
  });

  const teams = {};
  Object.entries(acc).forEach(([abbr, scopes]) => {
    teams[toEspn(abbr)] = {
      season: { offense: finishOffense(scopes.season.off, hasFtn, hasPart), defense: finishDefense(scopes.season.def, hasFtn, hasPart) },
      last3: scopes.last3 ? { offense: finishOffense(scopes.last3.off, hasFtn, hasPart), defense: finishDefense(scopes.last3.def, hasFtn, hasPart) } : null,
      last3_games: [...(last3[abbr] || [])]
    };
  });

  return {
    season,
    data_through_week: maxWeek || null,
    sources: {
      pbp: { file: `play_by_play_${season}`, through_week: maxWeek || null },
      ftn: ftnAsset ? { file: ftnFile.replace('.csv', ''), through_week: ftnMaxWeek || null, updated_at: ftnAsset.updated_at } : null,
      participation: partAsset ? { file: partFile.replace('.csv', ''), updated_at: partAsset.updated_at } : null
    },
    league: { offense: finishOffense(league.off, hasFtn, hasPart), defense: finishDefense(league.def, hasFtn, hasPart) },
    teams
  };
};

// --- Storage ----------------------------------------------------------------

const memo = {};

const refreshTendencies = async (season, opts) => {
  const result = await buildTendencies(season, opts);
  await db.saveDataset(`tendencies_${season}`, result, { data_through_week: result.data_through_week });
  memo[season] = { ...result, updated_at: new Date().toISOString() };
  return memo[season];
};

const getTendencies = async (season) => {
  if (memo[season]) return memo[season];
  const row = await db.loadDataset(`tendencies_${season}`);
  if (row) {
    memo[season] = { ...row.data, updated_at: row.updated_at };
    return memo[season];
  }
  // Completed seasons ship as static reference files (built by scripts/build-tendencies.js).
  if (fs.existsSync(referencePath(season))) {
    memo[season] = JSON.parse(fs.readFileSync(referencePath(season), 'utf8'));
    return memo[season];
  }
  return null;
};

// Latest completed season with participation data (personnel / coverage), for the reference panel.
const getReference = async (season) => {
  for (let s = season; s >= season - 2; s -= 1) {
    const t = await getTendencies(s);
    if (t?.sources?.participation) return t;
  }
  return null;
};

const teamView = async (teamAbbr, season) => {
  const [current, reference] = await Promise.all([getTendencies(season), getReference(season)]);
  if (!current && !reference) return null;
  const ref = reference && reference.season !== current?.season ? reference : null;
  const pick = (t) => {
    if (!t) return null;
    const r = t.teams[teamAbbr];
    if (!r) return null;
    return {
      year: t.season,
      data_through_week: t.data_through_week,
      sources: t.sources,
      season: r.season, // season-to-date splits
      last3: r.last3,
      last3_games: r.last3_games,
      league: t.league
    };
  };
  return {
    team: teamAbbr,
    current: pick(current),
    // Personnel, man/zone and coverage shells from the latest season nflverse has published them for.
    reference: ref ? {
      season: ref.season,
      note: `nflverse has not published ${season} participation data (personnel groupings, man/zone, coverage shells) yet; it is released after the season. Showing ${ref.season} full season.`,
      offense: { personnel: ref.teams[teamAbbr]?.season.offense.personnel || null, formation: ref.teams[teamAbbr]?.season.offense.formation || null },
      defense: ref.teams[teamAbbr]?.season.defense.participation || null,
      league: { personnel: ref.league.offense.personnel, defense: ref.league.defense.participation }
    } : null,
    updated_at: current?.updated_at || null
  };
};

module.exports = {
  buildTendencies,
  refreshTendencies,
  getTendencies,
  getReference,
  teamView,
  referencePath,
  offensePersonnelGroup,
  defenseCounts
};
