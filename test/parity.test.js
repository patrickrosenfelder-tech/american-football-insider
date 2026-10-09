const fs = require('fs');
const { registry, evaluate } = require('../src/services/modelInference');
const lines = fs.readFileSync(require('path').join(__dirname, 'fixtures/parity_20.csv'), 'utf8').trim().split(/\r?\n/);
const headers = lines.shift().split(',');
const rows = lines.map((line) => Object.fromEntries(line.split(',').map((value, i) => [headers[i], value])));
test('20 Python export rows satisfy the exact v2 feature contract and prediction parity', () => {
  expect(rows).toHaveLength(20);
  for (const row of rows) {
    const nodeFeatures = Object.fromEntries(registry.features.map((name) => [name, Number(row[name])]));
    expect(Object.keys(nodeFeatures).sort()).toEqual([...registry.features].sort());
    const prediction = evaluate(nodeFeatures);
    expect(prediction.probability).toBeCloseTo(Number(row.expected_v2_probability), 12);
    expect(prediction.margin).toBeCloseTo(Number(row.expected_v2_margin), 12);
  }
});
