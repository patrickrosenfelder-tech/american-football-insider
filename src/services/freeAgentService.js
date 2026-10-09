// Top free agents (in-season): currently unsigned players ranked by the AFI FA score.
// Candidates: 2026 released/waived players from ESPN's transaction wire plus veterans with 2025 snaps
// who are on no 2026 roster (nflverse). Anyone who signed afterwards (ESPN "Signed ..." / weekly rosters)
// is dropped, and the final list is confirmed one by one against ESPN's athlete status ("Free Agent").

const axios = require('axios');
const db = require('../db/database');
const { assetUrl, streamCsv } = require('./nflverseService');
const { currentSeason } = require('./rosterService');
const { transactions, clauses } = require('./tradeService');
const profiles = require('./playerProfileService');

const FA_KEY = (season) => `free_agents_${season}`;
// Core API athlete record (~5 KB, vs ~125 KB for the site athlete page payload).
const ATHLETE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes';
const LIST_SIZE = 50;
const PS_LIST_SIZE = 15;
const MAX_CHECKS = 240;

const FORMULA = [
  'AFI FA score (0-100) = 100 × snap factor × positional value × (0.3 + 0.7 × production) × age factor.',
  'Snap factor = √(min(1, 2025+2026 offensive/defensive snaps ÷ 1,500)); kickers/punters/long snappers use games played ÷ 17.',
  'Positional value: QB 1.00, EDGE 0.80, OT 0.75, WR 0.72, CB 0.70, IDL 0.62, S 0.55, TE 0.52, IOL/LB 0.50, RB 0.45, K 0.20, P 0.18, LS 0.08.',
  'Production = percentile within the position over 2025-26: QB EPA per play (pass + rush + sacks); WR/TE yards per target; RB yards per touch; EDGE/IDL (sacks + ½ QB hits + ¼ TFL) per 100 snaps; LB (tackles + TFL + 2×sacks + 2×PD + 3×INT) per 100 snaps; CB/S (PD + 2×INT) per 100 snaps; K FG%; P net average; OL by snap share. Below the minimum sample = 0.35.',
  'Age factor: −6% per year past 28 (QB 32, RB 26 at −10%/yr), floor 0.5. Players without 2025-26 NFL snaps rank below everyone with production.'
].join(' ');

const TARGET = { QB: 2, RB: 3, WR: 6, TE: 3, OT: 4, IOL: 5, EDGE: 5, IDL: 4, LB: 4, CB: 5, S: 4, K: 1, P: 1, LS: 1 };

const dateOnly = (d) => String(d || '').slice(0, 10);
// nflverse abbreviations -> ESPN's (used everywhere else on the site).
const espnAbbr = (t) => ({ LA: 'LAR', WAS: 'WSH' }[t] || t);
const POS_RE = /^(QB|RB|HB|FB|WR|TE|OT|T|G|OG|C|OL|IOL|DE|DT|NT|DL|EDGE|LB|ILB|OLB|MLB|CB|DB|S|FS|SS|K|PK|P|LS)\s+(.+)$/;
// "Released DB X from the practice squad with an injury settlement" -> names ["X"], flags.
const QUALIFIER = /\s+(?:from|off|with|to|after|due|on|following|as|in|at)\b.*$/i;
const playersIn = (clause) => {
  const body = clause.replace(/^\S+(?:\/injured)?\s+(?:the contract of\s+)?/i, '').replace(QUALIFIER, '');
  return body.split(/,\s*(?:and\s+)?|\s+and\s+/).map((s) => s.trim().match(POS_RE)).filter(Boolean)
    .map((m) => ({ position: m[1], name: m[2].replace(QUALIFIER, '').trim() }));
};

// Parse the 2026 wire into the latest release and latest signing per player.
const wire = async () => {
  const releases = {};
  const signings = {};
  (await transactions()).forEach((t) => {
    const team = t.team?.abbreviation || null;
    const date = t.date;
    clauses(t.description).forEach((c) => {
      const ps = /practice squad/i.test(c);
      if (/^(Released|Waived|Waiving|Terminated)\b/i.test(c)) {
        playersIn(c).forEach((p) => {
          const k = profiles.normName(p.name);
          if (!releases[k] || releases[k].date < date) {
            releases[k] = { ...p, team, date, practice_squad: ps, injury_settlement: /injury settlement/i.test(c), waived_injured: /waived\/injured/i.test(c), text: c };
          }
        });
      } else if (/^(Signed|Re-signed|Resigned|Claimed|Promoted|Agreed|Acquired|Activated|Elevated)\b/i.test(c)) {
        playersIn(c).forEach((p) => {
          const k = profiles.normName(p.name);
          if (!signings[k] || signings[k].date < date) signings[k] = { ...p, team, date, practice_squad: ps && !/from the practice squad/i.test(c) };
        });
      }
    });
  });
  return { releases, signings };
};

// Latest nflverse weekly roster: who is on a team, plus positional counts for team needs.
const weeklyRoster = async (season) => {
  const rows = [];
  let maxWeek = 0;
  await streamCsv(assetUrl('weekly_rosters', `roster_weekly_${season}.csv`), (r) => {
    const w = Number(r.week) || 0;
    if (w < maxWeek - 1) return;
    maxWeek = Math.max(maxWeek, w);
    rows.push(r);
  }, { columns: ['team', 'position', 'depth_chart_position', 'status', 'gsis_id', 'espn_id', 'week'] });
  return rows.filter((r) => Number(r.week) === maxWeek);
};

const teamNeeds = (roster, prof) => {
  const needs = {};
  roster.forEach((r) => {
    const g = profiles.groupOf(r.depth_chart_position) || profiles.groupOf(r.position);
    if (!g) return;
    const t = (needs[espnAbbr(r.team)] ||= {});
    const n = (t[g] ||= { healthy: 0, injured: 0, injured_starters: 0 });
    if (r.status === 'ACT') n.healthy += 1;
    else if (['RES', 'INA', 'PUP', 'NON'].includes(r.status)) {
      n.injured += 1;
      const p = prof.byGsis[r.gsis_id];
      if ((profiles.snapShare(p?.seasons?.[2026]) || 0) >= 50) n.injured_starters += 1;
    }
  });
  return (group) => Object.entries(needs).map(([team, t]) => {
    const n = t[group] || { healthy: 0, injured: 0, injured_starters: 0 };
    const need = Math.max(0, (TARGET[group] || 2) - n.healthy) + n.injured_starters + 0.25 * n.injured;
    return { team, need: Math.round(need * 100) / 100, healthy: n.healthy, injured: n.injured, injured_starters: n.injured_starters };
  }).filter((x) => x.need > 0).sort((a, b) => b.need - a.need || b.injured_starters - a.injured_starters).slice(0, 3);
};

// --- Scoring -------------------------------------------------------------------------

const sum2 = (p, f) => profiles.SEASONS.reduce((n, s) => n + (p.seasons[s] ? f(p.seasons[s]) : 0), 0);
const METRICS = {
  QB: { v: (p) => sum2(p, (s) => (s.passing_epa || 0) + (s.rushing_epa || 0)) / sum2(p, (s) => (s.attempts || 0) + (s.carries || 0) + (s.sacks_suffered || 0)), n: (p) => sum2(p, (s) => s.attempts || 0), min: 100 },
  WR: { v: (p) => sum2(p, (s) => s.receiving_yards || 0) / sum2(p, (s) => s.targets || 0), n: (p) => sum2(p, (s) => s.targets || 0), min: 20 },
  RB: { v: (p) => sum2(p, (s) => (s.rushing_yards || 0) + (s.receiving_yards || 0)) / sum2(p, (s) => (s.carries || 0) + (s.receptions || 0)), n: (p) => sum2(p, (s) => (s.carries || 0) + (s.receptions || 0)), min: 40 },
  PASSRUSH: { v: (p) => sum2(p, (s) => (s.def_sacks || 0) + 0.5 * (s.def_qb_hits || 0) + 0.25 * (s.def_tackles_for_loss || 0)) / sum2(p, (s) => s.def_snaps || 0) * 100, n: (p) => sum2(p, (s) => s.def_snaps || 0), min: 150 },
  LB: { v: (p) => sum2(p, (s) => (s.def_tackles_solo || 0) + (s.def_tackle_assists || 0) + (s.def_tackles_for_loss || 0) + 2 * (s.def_sacks || 0) + 2 * (s.def_pass_defended || 0) + 3 * (s.def_interceptions || 0)) / sum2(p, (s) => s.def_snaps || 0) * 100, n: (p) => sum2(p, (s) => s.def_snaps || 0), min: 150 },
  COVER: { v: (p) => sum2(p, (s) => (s.def_pass_defended || 0) + 2 * (s.def_interceptions || 0)) / sum2(p, (s) => s.def_snaps || 0) * 100, n: (p) => sum2(p, (s) => s.def_snaps || 0), min: 150 },
  K: { v: (p) => sum2(p, (s) => s.fg_made || 0) / sum2(p, (s) => s.fg_att || 0), n: (p) => sum2(p, (s) => s.fg_att || 0), min: 10 },
  P: { v: (p) => sum2(p, (s) => s.pt_net_yards || 0) / sum2(p, (s) => s.pt_att || 0), n: (p) => sum2(p, (s) => s.pt_att || 0), min: 20 },
  OL: { v: (p) => sum2(p, (s) => s.pct_sum || 0) / Math.max(1, sum2(p, (s) => s.snap_games || 0)), n: (p) => sum2(p, (s) => s.off_snaps || 0), min: 150 }
};
const METRIC_FOR = { QB: 'QB', WR: 'WR', TE: 'WR', RB: 'RB', EDGE: 'PASSRUSH', IDL: 'PASSRUSH', LB: 'LB', CB: 'COVER', S: 'COVER', K: 'K', P: 'P', OT: 'OL', IOL: 'OL' };

// Sorted metric values per position group, for percentiles.
const distributions = (prof) => {
  const dist = {};
  Object.values(prof.byGsis).forEach((p) => {
    const key = METRIC_FOR[p.group];
    const m = METRICS[key];
    if (!m || m.n(p) < m.min) return;
    const v = m.v(p);
    if (Number.isFinite(v)) (dist[`${p.group}`] ||= []).push(v);
  });
  Object.values(dist).forEach((a) => a.sort((x, y) => x - y));
  return dist;
};

const percentile = (sorted, v) => {
  if (!sorted?.length) return 0.5;
  let lo = 0;
  while (lo < sorted.length && sorted[lo] <= v) lo += 1;
  return lo / sorted.length;
};

const ageFactor = (age, group) => {
  if (age == null) return 0.9;
  const peak = group === 'RB' ? 26 : group === 'QB' ? 32 : 28;
  return Math.max(0.5, 1 - Math.max(0, age - peak) * (group === 'RB' ? 0.1 : 0.06));
};

const scorePlayer = (p, dist, age) => {
  const snaps = sum2(p, (s) => (s.off_snaps || 0) + (s.def_snaps || 0));
  const games = sum2(p, (s) => s.snap_games || s.games || 0);
  const st = ['K', 'P', 'LS'].includes(p.group);
  const snapFactor = st ? Math.sqrt(Math.min(1, games / 17)) : Math.sqrt(Math.min(1, snaps / 1500));
  const m = METRICS[METRIC_FOR[p.group]];
  const production = m && m.n(p) >= m.min && Number.isFinite(m.v(p)) ? percentile(dist[p.group], m.v(p)) : 0.35;
  const score = 100 * snapFactor * (profiles.POS_VALUE[p.group] || 0.3) * (0.3 + 0.7 * production) * ageFactor(age, p.group);
  return { score: Math.round(score * 10) / 10, snaps, games, production: Math.round(production * 100), has_snaps: snaps > 0 || (st && games > 0) };
};

// --- Build ---------------------------------------------------------------------------

const espnStatus = async (espnId) => {
  const { data } = await axios.get(`${ATHLETE}/${espnId}`, { timeout: 12000, headers: { 'User-Agent': 'American-Football-Insider/1.0' } });
  return { type: data.status?.type || null, name: data.status?.name || null, age: data.age ?? null, headshot: data.headshot?.href || null, position: data.position?.abbreviation || null };
};

async function buildFreeAgents(season) {
  const [prof, { releases, signings }, roster] = await Promise.all([profiles.loadProfiles(), wire(), weeklyRoster(season).catch(() => [])]);
  const onRoster = new Set(roster.filter((r) => ['ACT', 'DEV', 'RES', 'INA', 'PUP', 'NON', 'EXE', 'SUS'].includes(r.status)).map((r) => r.gsis_id));
  const dist = distributions(prof);
  const fits = teamNeeds(roster, prof);

  const candidates = new Map(); // gsis/name -> candidate
  // 1. Released / waived in 2026, not signed again afterwards.
  Object.entries(releases).forEach(([k, rel]) => {
    const signed = signings[k];
    if (signed && signed.date >= rel.date) return;
    const p = profiles.findByName(prof, rel.name, { position: rel.position, team: rel.team });
    if (!p?.espn_id) return;
    candidates.set(p.gsis_id || k, { p, release: rel });
  });
  // 2. Veterans with 2025 snaps who are on no 2026 roster.
  Object.values(prof.byGsis).forEach((p) => {
    if (!p.espn_id || candidates.has(p.gsis_id) || onRoster.has(p.gsis_id)) return;
    if (p.last_season !== 2025 || !p.seasons[2025]?.snap_games) return;
    if (signings[profiles.normName(p.name)]) return;
    candidates.set(p.gsis_id, { p, release: null });
  });

  const scored = [...candidates.values()].map(({ p, release }) => {
    const age = profiles.ageOn(p.birth_date);
    return { p, release, age, ...scorePlayer(p, dist, age) };
  }).sort((a, b) => (b.has_snaps - a.has_snaps) || b.score - a.score);

  // 3. Confirm with ESPN, best first, until both lists are full.
  const agents = [];
  const practice = [];
  let checks = 0;
  let checkErrors = 0;
  const queue = scored.filter((c) => !c.release?.practice_squad || c.snaps >= 100);
  const psQueue = scored.filter((c) => c.release?.practice_squad && c.snaps < 100);
  const confirm = async (list, out, size) => {
    let i = 0;
    const worker = async () => {
      while (i < list.length && out.length < size && checks < MAX_CHECKS) {
        const c = list[i++];
        checks += 1;
        try {
          const st = await espnStatus(c.p.espn_id);
          if (st.type === 'free-agent') out.push({ ...c, espn: st });
        } catch { checkErrors += 1; }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    out.sort((a, b) => (b.has_snaps - a.has_snaps) || b.score - a.score);
    out.splice(size);
  };
  await confirm(queue, agents, LIST_SIZE);
  await confirm(psQueue, practice, PS_LIST_SIZE);

  const row = (c) => {
    const p = c.p;
    const last = espnAbbr(c.release?.team || p.seasons[2026]?.last_team || p.seasons[2025]?.last_team || p.latest_team || null);
    return {
      id: p.espn_id, name: p.name, position: c.espn.position || p.position, group: p.group, age: c.espn.age ?? c.age,
      headshot: c.espn.headshot || p.headshot, last_team: last,
      status: c.release ? `${c.release.waived_injured ? 'Waived/injured' : /waiv/i.test(c.release.text) ? 'Waived' : 'Released'} ${dateOnly(c.release.date)}${c.release.injury_settlement ? ' (injury settlement)' : ''}` : 'UFA — unsigned since 2025',
      released_date: c.release ? dateOnly(c.release.date) : null, practice_squad: Boolean(c.release?.practice_squad),
      score: c.score, production_pct: c.production, snaps_2025_26: c.snaps,
      key_stats: { 2025: profiles.keyStats(p, 2025), 2026: profiles.keyStats(p, 2026) },
      team_fits: p.group ? fits(p.group).filter((f) => f.team !== last) : []
    };
  };

  // Recently signed: anyone who was a free agent (released in 2026 or unsigned vet) and signed in the last 14 days.
  const prev = (await db.loadDataset(FA_KEY(season)))?.data;
  const prevNames = new Set([...(prev?.agents || []), ...(prev?.recently_signed || [])].map((a) => profiles.normName(a.name)));
  const twoWeeks = Date.now() - 14 * 864e5;
  const recentlySigned = Object.entries(signings).filter(([k, s]) => Date.parse(s.date) >= twoWeeks && !s.practice_squad
    && ((releases[k] && releases[k].date < s.date && releases[k].team !== s.team) || prevNames.has(k)))
    .map(([, s]) => {
      const p = profiles.findByName(prof, s.name, { position: s.position, team: s.team });
      return p && sum2(p, (x) => (x.off_snaps || 0) + (x.def_snaps || 0)) > 0
        ? { name: p.name, position: s.position, new_team: s.team, signed_date: dateOnly(s.date), headshot: p.headshot, snaps_2025_26: sum2(p, (x) => (x.off_snaps || 0) + (x.def_snaps || 0)) } : null;
    }).filter(Boolean).sort((a, b) => b.signed_date.localeCompare(a.signed_date) || b.snaps_2025_26 - a.snaps_2025_26).slice(0, 25);

  const data = {
    season, agents: agents.map(row), practice_squad: practice.map(row), recently_signed: recentlySigned,
    candidates: scored.length, espn_checks: checks, espn_check_errors: checkErrors,
    data_through: prof.dataThrough, source: 'ESPN transactions + ESPN athlete status + nflverse players/stats/snap counts/weekly rosters',
    updated_at: new Date().toISOString()
  };
  if (!data.agents.length && prev?.agents?.length) throw new Error(`no confirmed free agents (${checks} ESPN checks, ${checkErrors} errors); kept previous list`);
  await db.saveDataset(FA_KEY(season), data, { players: data.agents.length });
  return { players: data.agents.length, practice_squad: data.practice_squad.length, recently_signed: recentlySigned.length, candidates: scored.length };
}

// Single flight: the daily job, boot and a cold page view must not build the list concurrently (256 MB VM).
let inflight = null;
const refreshFreeAgents = (season = currentSeason()) => {
  if (!inflight) inflight = buildFreeAgents(season).finally(() => { inflight = null; });
  return inflight;
};

async function getFreeAgents() {
  const season = currentSeason();
  let row = await db.loadDataset(FA_KEY(season));
  // Rebuild when missing or still in the pre-ranking shape (no practice_squad list).
  if (!row || !Array.isArray(row.data?.practice_squad)) { await refreshFreeAgents(season); row = await db.loadDataset(FA_KEY(season)); }
  const fix = (a) => ({ ...a, last_team: espnAbbr(a.last_team), team_fits: (a.team_fits || []).map((f) => ({ ...f, team: espnAbbr(f.team) })) });
  const data = row?.data || { season, agents: [], practice_squad: [], recently_signed: [] };
  return { ...data, agents: (data.agents || []).map(fix), practice_squad: (data.practice_squad || []).map(fix), last_updated: row?.updated_at || null, formula: FORMULA };
}

module.exports = { refreshFreeAgents, getFreeAgents, playersIn, scorePlayer };
