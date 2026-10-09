#!/usr/bin/env python3
"""Add registry predictions to the fixed Python-export parity fixture."""
import csv, json, math, pathlib
root = pathlib.Path(__file__).parent
model = json.loads((root / 'model_v2.json').read_text())
path = root.parent.parent / 'test' / 'fixtures' / 'parity_20.csv'
rows = list(csv.DictReader(path.open()))
for row in rows:
    def score(kind): return sum(float(row[name]) * model['coefficients'][kind][name] for name in model['features'])
    logit = score('win_probability')
    row['expected_v2_probability'] = format(1 / (1 + math.exp(-max(-30, min(30, logit)))), '.15g')
    row['expected_v2_margin'] = format(score('home_margin'), '.15g')
with path.open('w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)
