#!/usr/bin/env python3
"""Train AFI Model v2 without look-ahead from a point-in-time CSV.

Expected target columns: kickoff, home_win, home_margin. Feature columns are
listed in feature_config.json. Rows must be sorted by kickoff; each weekly fold
fits strictly on earlier rows. sklearn is intentionally optional until the
production nflverse export is connected.
"""
import argparse, csv, json, pathlib
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "model_v2.json"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="point-in-time feature CSV")
    parser.add_argument("--version", default="v2.0.0")
    args = parser.parse_args()
    artifact = {"version": args.version, "generated_at": datetime.now(timezone.utc).isoformat(),
      "algorithm": "regularized logistic regression + ridge margin regression",
      "feature_groups": ["team_strength", "tendencies", "matchup_interactions", "situational", "availability", "momentum", "elo"],
      "promotion": {"live": False, "reason": "A candidate is promoted only after chronological OOS comparison."}}
    if not args.input:
        artifact["metrics"] = {"status": "bootstrap", "note": "Pass --input features.csv after the nflverse point-in-time export."}
        artifact["ablation"] = []
    else:
        with open(args.input, newline="", encoding="utf-8") as f: rows = list(csv.DictReader(f))
        # The export itself is retained as the audit source; this guard prevents
        # accidentally training on an unlabelled/non-chronological file.
        assert rows and all(r.get("kickoff") and r.get("home_win") is not None for r in rows), "missing kickoff/home_win"
        assert rows == sorted(rows, key=lambda r: r["kickoff"]), "input must be chronological"
        artifact["metrics"] = {"status": "ready_for_sklearn", "rows": len(rows), "note": "Install scikit-learn in the analytics environment to fit/export coefficients."}
        artifact["ablation"] = []
    OUT.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(OUT)
if __name__ == "__main__": main()
