const { getTendencies } = require('./tendencyService');

// Key-matchup output is intentionally conservative: no venue or surface
// defaults, and every retained signal has a numeric, game-specific sample.
const make = (icon, label, text, impact, sample) => ({ icon, label, text, impact: Math.min(2, Math.max(-2, impact)), sample });

async function getMicroMatchups({ season, home, away, weather }) {
  const tendencies = await getTendencies(season).catch(() => null);
  const h = tendencies?.teams?.[home]; const a = tendencies?.teams?.[away];
  const out = [];
  const blitz = (def, offense, defense, opponent) => {
    const rate = def?.defense?.ftn?.blitz_rate; const epa = offense?.offense?.pass_epa;
    const sample = def?.defense?.ftn?.charted_plays || 0;
    if (sample >= 50 && rate != null && rate >= 40 && epa != null && epa < 0) out.push(make('🔥', 'Pass-rush key', `${defense} blitzes ${rate}% over ${sample} charted snaps; ${opponent}'s passing EPA/play is ${epa}. AFI adjusts ${defense} by +1.0 point.`, 1, sample));
  };
  blitz(h, a, home, away); blitz(a, h, away, home);
  const coverage = (def, offense, defense, opponent) => {
    const man = def?.defense?.participation?.man_rate; const pass = offense?.offense?.pass_epa;
    const sample = def?.defense?.participation?.plays || 0;
    if (sample >= 50 && man != null && man >= 40 && pass != null && pass < 0) out.push(make('🎯', 'Coverage key', `${defense} plays man coverage ${man}% over ${sample} charted snaps; ${opponent}'s passing EPA/play is ${pass}. AFI adjusts ${defense} by +0.8 point.`, 0.8, sample));
  };
  coverage(h, a, home, away); coverage(a, h, away, home);
  if (weather?.impact?.level && weather.impact.level !== 'none' && /\d/.test(weather.impact.note || '')) out.push(make('🌧', 'Weather', weather.impact.note, 0.5, null));
  return out.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact)).slice(0, 3);
}

module.exports = { getMicroMatchups };
