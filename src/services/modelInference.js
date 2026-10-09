// The v2 registry is evaluated in raw feature units.  This module deliberately
// accepts only the registry's declared features: no implicit zero-only fields.
const registry = require('../../scripts/model/model_v2.json');
const sigmoid = (x) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const evaluate = (features) => {
  const missing = registry.features.filter((name) => !Number.isFinite(Number(features[name])));
  if (missing.length) throw new Error(`v2 feature contract missing: ${missing.join(', ')}`);
  const score = (kind) => registry.features.reduce((sum, name) => sum + registry.coefficients[kind][name] * Number(features[name]), 0);
  const logit = score('win_probability');
  return { probability: sigmoid(logit), margin: score('home_margin'), logit };
};
module.exports = { registry, evaluate };
