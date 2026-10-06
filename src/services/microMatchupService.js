const { getTendencies } = require('./tendencyService');

// Home fields; this is intentionally static and independently auditable.  “hybrid”
// covers the natural/synthetic reinforced grass systems used by some clubs.
const HOME_SURFACES = {
  ARI: 'turf', ATL: 'turf', BAL: 'natural grass', BUF: 'turf', CAR: 'natural grass', CHI: 'natural grass', CIN: 'turf', CLE: 'natural grass',
  DAL: 'turf', DEN: 'natural grass', DET: 'turf', GB: 'hybrid', HOU: 'turf', IND: 'turf', JAX: 'natural grass', KC: 'natural grass',
  LAC: 'turf', LAR: 'turf', LV: 'turf', MIA: 'natural grass', MIN: 'turf', NE: 'turf', NO: 'turf', NYG: 'turf', NYJ: 'turf',
  PHI: 'natural grass', PIT: 'natural grass', SEA: 'turf', SF: 'natural grass', TB: 'natural grass', TEN: 'natural grass', WSH: 'natural grass'
};

const make = (icon, label, text, impact) => ({ icon, label, text, impact: Math.min(2, Math.max(-2, impact)) });

async function getMicroMatchups({ season, home, away, weather }) {
  const tendencies = await getTendencies(season).catch(() => null);
  const h = tendencies?.teams?.[home]; const a = tendencies?.teams?.[away];
  const out = [];
  const blitz = (def, offense, defense, opponent) => {
    const rate = def?.defense?.ftn?.blitz_rate; const epa = offense?.offense?.pass_epa;
    if (rate != null && rate >= 40 && epa != null && epa < 0) out.push(make('🔥', 'Blitz matchup', `${defense} blitzes ${rate}% of dropbacks; ${opponent}'s passing EPA is ${epa}.`, 1));
  };
  blitz(h, a, home, away); blitz(a, h, away, home);
  const coverage = (def, offense, defense, opponent) => {
    const man = def?.defense?.participation?.man_rate; const pass = offense?.offense?.pass_epa;
    if (man != null && man >= 40 && pass != null && pass < 0) out.push(make('🎯', 'Coverage matchup', `${defense} uses man coverage ${man}% of charted snaps; ${opponent}'s passing profile is a potential mismatch.`, 0.75));
  };
  coverage(h, a, home, away); coverage(a, h, away, home);
  const surface = HOME_SURFACES[home] || 'unknown surface';
  out.push(make('🏟', 'Surface', `${home}'s home field is ${surface}. Surface splits require the minimum 20-carry / 30-target sample before player claims appear.`, 0));
  if (weather?.impact?.level && weather.impact.level !== 'none') out.push(make('🌧', 'Weather', weather.impact.note || 'Weather conditions may affect this matchup.', 0.5));
  return out.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact)).slice(0, 3);
}

module.exports = { HOME_SURFACES, getMicroMatchups };
