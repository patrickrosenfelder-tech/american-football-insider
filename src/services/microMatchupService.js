const { getTendencies } = require('./tendencyService');

// Key-matchup output is intentionally conservative: no venue or surface
// defaults, and every retained signal has a numeric, game-specific sample.
const make = (icon, label, text, impact, sample) => ({ icon, label, text, impact: Math.min(2, Math.max(-2, impact)), sample });
const n = (v) => Number(v) || 0;
const one = (v) => Math.round(v * 10) / 10;

const injuryNames = (side) => (side?.key_injuries || [])
  .filter((i) => i.starter && ['Out', 'Doubtful', 'Injured Reserve'].includes(i.status) && /^(C|G|OT|OG|OL|T)$/i.test(i.position || ''))
  .map((i) => i.name);

async function getMicroMatchups({ season, home, away, weather, preview }) {
  const tendencies = await getTendencies(season).catch(() => null);
  const h = tendencies?.teams?.[home]; const a = tendencies?.teams?.[away];
  const out = [];
  const qbSplit = (side, opponent, isRoad) => {
    const qb = side?.starting_qb;
    const line = qb?.season || {};
    const attempts = Number(line.attempts) || 0;
    const yards = Number(line.passing_yards) || 0;
    // A venue tag alone is not an edge.  Retain a home/road signal only for a
    // material split; historical split data is deliberately never inferred.
    const split = qb?.splits?.home_road;
    if (!qb?.name || !split || n(split.home_attempts) < 50 || n(split.road_attempts) < 50) return;
    const homeYpa = n(split.home_yards) / n(split.home_attempts);
    const roadYpa = n(split.road_yards) / n(split.road_attempts);
    if (Math.abs(homeYpa - roadYpa) < 1.0) return;
    const ypa = Math.round((yards / attempts) * 10) / 10;
    const condition = isRoad ? 'on the road' : 'at home';
    out.push(make('🏈', 'QB home/road split', `${qb.name}: ${one(roadYpa)} YPA on the road vs ${one(homeYpa)} at home (${condition} game; ${attempts} season attempts).`, isRoad ? -0.6 : 0.6, n(split.home_attempts) + n(split.road_attempts)));
  };
  // The road/home split is evaluated for this exact venue; the attempt minimum
  // prevents a one-game quarterback claim from appearing on a pick card.
  qbSplit(preview?.away, preview?.home || {}, true);
  qbSplit(preview?.home, preview?.away || {}, false);
  const blitz = (def, offense, defense, opponent) => {
    const rate = def?.defense?.ftn?.blitz_rate; const epa = offense?.offense?.pass_epa;
    const sample = def?.defense?.ftn?.charted_plays || 0;
    const injured = injuryNames(offense);
    if (sample >= 50 && rate != null && rate >= 35 && epa != null && epa < 0 && injured.length) out.push(make('🔥', 'Pass rush vs injured OL', `${defense} blitzes ${rate}% over ${sample} charted dropbacks; ${opponent} is without starting OL ${injured.join(', ')} and has ${epa} pass EPA/play.`, 1, sample));
  };
  blitz(h, a, home, away); blitz(a, h, away, home);
  const coverage = (def, offense, defense, opponent) => {
    const man = def?.defense?.participation?.man_rate; const pass = offense?.offense?.pass_epa;
    const sample = def?.defense?.participation?.plays || 0;
    if (sample >= 50 && man != null && (man >= 60 || man <= 30) && pass != null && Math.abs(pass) >= 0.08) out.push(make('🎯', 'Man/zone extreme', `${defense} plays ${man >= 60 ? 'man' : 'zone'} ${man}% over ${sample} charted snaps; ${opponent}'s passing EPA/play is ${pass}.`, pass < 0 ? 0.8 : -0.8, sample));
  };
  coverage(h, a, home, away); coverage(a, h, away, home);

  // Season stats supply the receiver's usage and the named depth-chart CB.
  // We disclose snaps and passes defended rather than fabricate coverage targets.
  const wrCb = (off, def, offTeam, defTeam) => {
    const wr = off?.wr1; const cb = def?.cb1;
    const targets = n(wr?.season?.targets); const yards = n(wr?.season?.receiving_yards);
    const cbSnaps = n(cb?.season?.def_snaps); const pd = n(cb?.season?.def_pass_defended);
    if (!wr?.name || !cb?.name || targets < 30 || cbSnaps < 25) return;
    const yprr = targets ? one(yards / targets) : 0;
    out.push(make('🎯', 'WR1 vs CB1', `${wr.name}: ${targets} targets, ${yprr} yards/target vs ${cb.name}, ${cbSnaps} defensive snaps and ${pd} passes defended.`, yprr >= 8 ? 0.7 : -0.4, Math.min(targets, cbSnaps)));
  };
  wrCb(preview?.away, preview?.home, away, home); wrCb(preview?.home, preview?.away, home, away);

  const rushVsOl = (def, off, defTeam, offTeam) => {
    const rusher = def?.edge_rusher; const qb = off?.starting_qb;
    const sacks = n(rusher?.season?.def_sacks); const allowed = n(qb?.season?.sacks_suffered);
    const injured = injuryNames(off);
    const yppAllowed = n(def?.stats?.defense?.yards_per_play);
    if (!rusher?.name || !qb?.name || yppAllowed <= 0 || yppAllowed > 5.6) return;
    const olNote = injured.length ? `; ${offTeam} is without starting OL ${injured.join(', ')}` : '';
    const sackNote = sacks ? `${rusher.name} has ${sacks} sacks` : `${rusher.name} starts on the edge`;
    const protection = allowed ? `${qb.name} has been sacked ${allowed} times` : `${qb.name} has ${n(qb?.season?.attempts)} attempts`;
    out.push(make('🔥', 'Pass rush vs OL', `${sackNote}; ${defTeam} allows ${yppAllowed} yards/play. ${protection}${olNote}.`, 0.8, Math.max(25, n(qb?.season?.attempts))));
  };
  rushVsOl(preview?.home, preview?.away, home, away); rushVsOl(preview?.away, preview?.home, away, home);

  // A volume signal is only useful when the back has cleared the stated
  // sample; this remains a transparent current-season threshold, not a fake
  // win/loss split when historical game logs are unavailable.
  const rbVolume = (side, team) => {
    const rb = side?.rb1; const carries = n(rb?.season?.carries); const yards = n(rb?.season?.rushing_yards);
    if (!rb?.name || carries < 20) return;
    const games = Math.max(1, n(rb.season.games)); const threshold = Math.round((yards / games) / 5) * 5;
    if (threshold < 45) return;
    out.push(make('🏃', 'RB1 volume threshold', `${team}'s ${rb.name} averages ${one(yards / games)} rush yards on ${carries} carries; the key is keeping him under ${threshold} yards.`, 0.5, carries));
  };
  rbVolume(preview?.away, away); rbVolume(preview?.home, home);
  return out.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact)).slice(0, 3);
}

module.exports = { getMicroMatchups };
