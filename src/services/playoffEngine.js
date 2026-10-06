// NFL standings, tiebreakers and playoff seeding for one set of game results.
// Pure functions (no I/O) so the same code runs for actual standings, user picks and Monte Carlo sims.
//
// teams: [{ id, conf, div }]
// games: [{ id, home, away, result: 'H' | 'A' | 'T' | null, home_score, away_score }]  (null = not decided)
//
// Tiebreakers implemented (NFL rulebook order), see README "Playoff predictor":
//   Division: head-to-head, division record, common games, conference record, strength of victory,
//             strength of schedule, net points (all games), coin toss.
//   Wild card: same-division ties first reduced to the division leader, then head-to-head (2 clubs: if they
//             met; 3+ clubs: only a sweep / swept), conference record, common games (min. 4), strength of
//             victory, strength of schedule, net points (all games), coin toss.
//   Simplified/skipped: combined conference/league ranking in points scored/allowed, net points in common /
//   conference games, net touchdowns. "Coin toss" is deterministic (team id order).

const EPS = 1e-9;

const pct = (w, l, t) => {
  const g = w + l + t;
  return g ? (w + t / 2) / g : 0;
};

const buildRecords = (teams, games) => {
  const rec = {};
  teams.forEach((t) => {
    rec[t.id] = { id: t.id, conf: t.conf, div: t.div, w: 0, l: 0, t: 0, dw: 0, dl: 0, dt: 0, cw: 0, cl: 0, ct: 0, pf: 0, pa: 0, games: [] };
  });
  games.forEach((g) => {
    if (!g.result) return;
    const h = rec[g.home];
    const a = rec[g.away];
    if (!h || !a) return;
    const hr = g.result === 'H' ? 1 : g.result === 'A' ? 0 : 0.5;
    const add = (r, opp, res, pf, pa) => {
      if (res === 1) r.w += 1; else if (res === 0) r.l += 1; else r.t += 1;
      if (r.div === opp.div) { if (res === 1) r.dw += 1; else if (res === 0) r.dl += 1; else r.dt += 1; }
      if (r.conf === opp.conf) { if (res === 1) r.cw += 1; else if (res === 0) r.cl += 1; else r.ct += 1; }
      if (pf != null && pa != null) { r.pf += pf; r.pa += pa; }
      r.games.push({ opp: opp.id, res });
    };
    add(h, a, hr, g.home_score, g.away_score);
    add(a, h, 1 - hr, g.away_score, g.home_score);
  });
  Object.values(rec).forEach((r) => {
    r.pct = pct(r.w, r.l, r.t);
    r.div_pct = pct(r.dw, r.dl, r.dt);
    r.conf_pct = pct(r.cw, r.cl, r.ct);
  });
  return rec;
};

// Win pct of `id` in games against opponents in `opps` (Set). Returns [pct, games].
const recordVs = (rec, id, opps) => {
  let w = 0; let n = 0;
  rec[id].games.forEach((g) => { if (opps.has(g.opp)) { w += g.res; n += 1; } });
  return [n ? w / n : 0, n];
};

const sov = (rec, id) => {
  let w = 0; let g = 0;
  rec[id].games.forEach((x) => {
    if (x.res !== 1) return;
    const o = rec[x.opp];
    w += o.w + o.t / 2; g += o.w + o.l + o.t;
  });
  return g ? w / g : 0;
};

const sos = (rec, id) => {
  let w = 0; let g = 0;
  rec[id].games.forEach((x) => {
    const o = rec[x.opp];
    w += o.w + o.t / 2; g += o.w + o.l + o.t;
  });
  return g ? w / g : 0;
};

const commonOpponents = (rec, ids) => {
  let common = null;
  ids.forEach((id) => {
    const opps = new Set(rec[id].games.map((g) => g.opp));
    common = common ? new Set([...common].filter((o) => opps.has(o))) : opps;
  });
  ids.forEach((id) => common.delete(id));
  return common;
};

// Each step returns a score per team (higher = better) or null when the step doesn't apply.
const STEPS = {
  h2h: (rec, ids) => {
    const group = new Set(ids);
    const scores = ids.map((id) => recordVs(rec, id, new Set([...group].filter((x) => x !== id))));
    if (scores.some(([, n]) => n === 0)) return null;
    return scores.map(([p]) => p);
  },
  // Wild card head-to-head: 2 clubs if they met; 3+ clubs only if one swept / was swept by all others.
  h2hWildcard: (rec, ids) => {
    if (ids.length === 2) return STEPS.h2h(rec, ids);
    const sweep = (id, want) => ids.every((o) => {
      if (o === id) return true;
      const gs = rec[id].games.filter((g) => g.opp === o);
      return gs.length > 0 && gs.every((g) => g.res === want);
    });
    const sweeper = ids.find((id) => sweep(id, 1));
    if (sweeper) return ids.map((id) => (id === sweeper ? 1 : 0));
    const swept = ids.filter((id) => sweep(id, 0));
    if (swept.length) return ids.map((id) => (swept.includes(id) ? 0 : 1));
    return null;
  },
  division: (rec, ids) => ids.map((id) => rec[id].div_pct),
  conference: (rec, ids) => ids.map((id) => rec[id].conf_pct),
  common: (min) => (rec, ids) => {
    const common = commonOpponents(rec, ids);
    const scores = ids.map((id) => recordVs(rec, id, common));
    if (scores.some(([, n]) => n < min)) return null;
    return scores.map(([p]) => p);
  },
  sov: (rec, ids) => ids.map((id) => sov(rec, id)),
  sos: (rec, ids) => ids.map((id) => sos(rec, id)),
  netPoints: (rec, ids) => ids.map((id) => rec[id].pf - rec[id].pa)
};

const DIVISION_STEPS = [STEPS.h2h, STEPS.division, STEPS.common(1), STEPS.conference, STEPS.sov, STEPS.sos, STEPS.netPoints];
const WILDCARD_STEPS = [STEPS.h2hWildcard, STEPS.conference, STEPS.common(4), STEPS.sov, STEPS.sos, STEPS.netPoints];

// Returns the single best team among tied `ids`. When a step separates some (but not all) teams,
// the procedure restarts with the remaining group, as the rulebook requires.
const breakTie = (rec, ids, steps, prepare = null) => {
  let group = prepare ? prepare(ids) : ids;
  if (group.length === 1) return group[0];
  for (const step of steps) {
    const scores = step(rec, group);
    if (!scores) continue;
    const best = Math.max(...scores);
    const top = group.filter((_, i) => scores[i] >= best - EPS);
    if (top.length < group.length) {
      group = top;
      return top.length === 1 ? top[0] : breakTie(rec, top, steps, prepare);
    }
  }
  return [...group].sort((a, b) => Number(a) - Number(b))[0]; // coin toss (deterministic)
};

// Orders `ids` by win pct, breaking ties one place at a time.
const rankGroup = (rec, ids, pickBest) => {
  const out = [];
  let left = [...ids];
  while (left.length) {
    const bestPct = Math.max(...left.map((id) => rec[id].pct));
    const tied = left.filter((id) => rec[id].pct >= bestPct - EPS);
    const pick = tied.length === 1 ? tied[0] : pickBest(tied);
    out.push(pick);
    left = left.filter((id) => id !== pick);
  }
  return out;
};

const computeStandings = (teams, games) => {
  const rec = buildRecords(teams, games);
  const divisions = {};
  teams.forEach((t) => { (divisions[t.div] ||= []).push(t.id); });

  const divRank = {};
  const divOrder = {};
  Object.entries(divisions).forEach(([div, ids]) => {
    const order = rankGroup(rec, ids, (tied) => breakTie(rec, tied, DIVISION_STEPS));
    divOrder[div] = order;
    order.forEach((id, i) => { divRank[id] = i; });
  });

  // Same-division clubs in a wild card tie: keep only the highest ranked one per division.
  const reduceByDivision = (ids) => {
    const best = {};
    ids.forEach((id) => {
      const d = rec[id].div;
      if (best[d] == null || divRank[id] < divRank[best[d]]) best[d] = id;
    });
    return Object.values(best);
  };
  const wildcardPick = (tied) => breakTie(rec, tied, WILDCARD_STEPS, reduceByDivision);

  const conferences = {};
  [...new Set(teams.map((t) => t.conf))].forEach((conf) => {
    const winners = Object.values(divOrder).map((o) => o[0]).filter((id) => rec[id].conf === conf);
    const seededWinners = rankGroup(rec, winners, wildcardPick);
    const rest = teams.filter((t) => t.conf === conf && !winners.includes(t.id)).map((t) => t.id);
    const restOrder = rankGroup(rec, rest, wildcardPick);
    conferences[conf] = { seeds: [...seededWinners, ...restOrder.slice(0, 3)], order: [...seededWinners, ...restOrder] };
  });

  return { records: rec, divisions: divOrder, conferences };
};

module.exports = { computeStandings, buildRecords, breakTie, pct };
