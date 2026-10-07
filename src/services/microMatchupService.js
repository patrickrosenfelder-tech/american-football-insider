/**
 * Matchup notes are intentionally conservative.  This service does not make
 * assertions from a team's venue, league averages, or an undersized split.
 * A data integration can pass verified signals here once it has checked the
 * documented sample thresholds; otherwise an empty array is the correct UI.
 */
const MINIMUM_SAMPLES = Object.freeze({ QB: 50, RB: 20, WR: 30, CB: 25 });

function validSignal(signal) {
  if (!signal || !signal.text || !signal.playerNames?.length) return false;
  if (!Number.isFinite(signal.sampleSize)) return false;
  const minimum = MINIMUM_SAMPLES[signal.position] || Infinity;
  return signal.sampleSize >= minimum && /\d/.test(signal.text);
}

function topSignals(signals = []) {
  return signals.filter(validSignal).sort((a, b) => b.impact - a.impact).slice(0, 3)
    .map(({ type, text, impact, playerNames, headshots }) => ({ type, text, impact, playerNames, headshots }));
}

module.exports = { MINIMUM_SAMPLES, topSignals };
