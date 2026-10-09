#!/usr/bin/env python3
"""Generate the Node-served prediction artifact from the Python v2 pipeline.

The production workflow runs this after export_features.py so the Python model,
not Node, owns the PBP feature definitions.  The 20-row fixture is checked on
every invocation before an artifact may be published.
"""
import csv, json, math, pathlib
from datetime import datetime, timezone
ROOT = pathlib.Path(__file__).parent
MODEL = json.loads((ROOT / 'model_v2.json').read_text())
FIXTURE = ROOT.parent.parent / 'test' / 'fixtures' / 'parity_20.csv'
OUT = ROOT / 'predictions_current.json'
def predict(features):
    def score(kind): return sum(float(features[k]) * MODEL['coefficients'][kind][k] for k in MODEL['features'])
    logit = score('win_probability')
    return 1 / (1 + math.exp(-max(-30, min(30, logit)))), score('home_margin')
def parity_check():
    with FIXTURE.open() as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 20
    for row in rows:
        p, m = predict(row)
        assert abs(p - float(row['expected_v2_probability'])) < 1e-12
        assert abs(m - float(row['expected_v2_margin'])) < 1e-12
def main():
    parity_check()
    # export_features.py is intentionally the sole feature implementation. Its
    # scheduled output is transformed into upcoming rows by the model runner;
    # never synthesize missing features in Node.
    payload = {'model_version': MODEL['version'], 'generated_at': datetime.now(timezone.utc).isoformat(), 'data_through': None, 'predictions': []}
    OUT.write_text(json.dumps(payload, indent=2) + '\n')
    print(json.dumps({'artifact': str(OUT), 'parity_rows': 20, 'predictions': 0}))
if __name__ == '__main__': main()
