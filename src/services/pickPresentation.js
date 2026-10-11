// All displayed prediction fields are derived from the stored prediction, including
// older kickoff snapshots. Never apply a newer model to a locked/graded wager.
const round1 = (v) => Math.round(v * 10) / 10;
const half = (v) => Math.round(v * 2) / 2;
const line = (v) => v > 0 ? `+${v}` : v === 0 ? 'PK' : `${v}`;
const stars = (edge) => edge >= 7 ? 5 : edge >= 5 ? 4 : edge >= 3 ? 3 : edge >= 1.5 ? 2 : 1;

const presentPick = (stored) => {
  if (!stored) return null;
  const p = { ...stored, model: { ...stored.model } };
  const margin = Number(p.model.home_margin);
  const spread = p.market?.spread_home;
  p.model.spread_home = half(-margin);
  const edge = spread == null ? 0 : Math.abs(margin + spread);
  p.confidence_edge = round1(edge);
  p.confidence_stars = stars(edge);
  const favorite = margin >= 0 ? p.home : p.away;
  const why = [margin === 0 ? 'The margin model projects a pick’em game.' : `The margin model makes ${favorite} a ${Math.abs(p.model.spread_home)}-point favorite.`];
  if (p.moneyline) why.push(`The win-probability model selects ${p.moneyline.team} at ${p.moneyline.model_prob}%.`);
  if (p.spread) why.push(`The ${p.confidence_stars}-star spread pick is ${p.spread.team} ${line(p.spread.line)}, with a ${p.confidence_edge}-point model-to-market edge.`);
  if (p.total) why.push(`The total pick is ${p.total.side.toUpperCase()} ${p.total.line} (projected total: ${p.model.total}; ${p.total_model_version || 'v1'} total model).`);
  // v2 uses separate regressions for margin and win probability. Their favorites
  // can differ; explain that instead of attributing one regression's odds to the other.
  if (/^v2\./.test(p.model_version || '')) why.push('Margin and win probability are estimated separately; totals use the v1 scoring/weather model.');
  if (p.injury_notes?.length) why.push(`Injury context: ${p.injury_notes.join('; ')}.`);
  p.reasoning = why.join(' ');
  return p;
};

module.exports = { presentPick, stars };
