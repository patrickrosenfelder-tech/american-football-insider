#!/usr/bin/env python3
"""Fit AFI's point-in-time model and write the Node-consumable registry artifact."""
import argparse, json, pathlib
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "model_v2.json"
GROUPS = {
    "team_strength": ["adj_epa_diff", "pass_epa_diff", "rush_epa_diff", "success_diff", "margin_diff"],
    "tendencies": ["early_pass_diff", "pressure_diff"],
    "matchup_interactions": ["pass_epa_x_pressure", "rush_epa_x_rush_def"],
    "situational": ["home_field", "rest_diff"], "availability": ["availability_diff", "availability_missing"],
    "momentum": ["recent_margin_diff", "upset_diff"], "elo": ["elo_diff", "elo_home_prob"],
}
def sigmoid(x): return 1 / (1 + np.exp(-np.clip(x, -30, 30)))
def cols(groups): return [f for g in groups for f in GROUPS[g]]
def scores(frame, prob, margin):
    actual = frame.home_win.astype(int).to_numpy()
    return {"games": int(len(frame)), "su_accuracy": round(float(((prob >= .5) == actual).mean()), 4), "log_loss": round(float(log_loss(actual, np.clip(prob, 1e-5, 1 - 1e-5))), 4), "brier": round(float(brier_score_loss(actual, prob)), 4), "margin_mae": round(float(np.abs(margin - frame.home_margin.to_numpy()).mean()), 3), "margin_rmse": round(float(np.sqrt(np.mean((margin - frame.home_margin.to_numpy()) ** 2))), 3)}
def fit_predict(train, test, features):
    x, xt = train[features].fillna(0), test[features].fillna(0)
    win = make_pipeline(StandardScaler(), LogisticRegression(C=.25, max_iter=2000))
    margin = make_pipeline(StandardScaler(), Ridge(alpha=12.0))
    win.fit(x, train.home_win.astype(int)); margin.fit(x, train.home_margin)
    return win.predict_proba(xt)[:, 1], margin.predict(xt), win, margin
def walk_forward(df, features, minimum):
    pred = []
    for kickoff, test in df.groupby("kickoff", sort=True):
        train = df[df.kickoff < kickoff]
        if len(train) < minimum or train.home_win.nunique() < 2: continue
        prob, margin, _, _ = fit_predict(train, test, features)
        out = test[["season", "week", "home_win", "home_margin", "closing_spread", "legacy_v1_margin"]].copy(); out["prob"] = prob; out["margin"] = margin; pred.append(out)
    return pd.concat(pred, ignore_index=True) if pred else pd.DataFrame()
def calibration(pred):
    result = []
    for low in np.arange(0, 1, .1):
        p = pred[(pred.prob >= low) & (pred.prob < low + .1)]
        if len(p): result.append({"range": f"{low:.1f}-{low + .1:.1f}", "games": len(p), "predicted": round(float(p.prob.mean()), 3), "actual": round(float(p.home_win.mean()), 3)})
    return result
def coefficient_map(model, features, classifier=True):
    scaler, est = model.named_steps["standardscaler"], model.steps[-1][1]; weights = est.coef_[0] if classifier else est.coef_
    return {n: round(float(w / s), 6) for n, w, s in zip(features, weights, scaler.scale_)}
def main():
    p = argparse.ArgumentParser(); p.add_argument("--input", required=True); p.add_argument("--output", default=str(OUT)); p.add_argument("--version", default="v2.1.0"); p.add_argument("--min-train", type=int, default=96); args = p.parse_args()
    df = pd.read_csv(args.input); required = {"kickoff", "season", "week", "home_win", "home_margin", "legacy_v1_margin"}
    if missing := required - set(df.columns): raise SystemExit(f"missing required columns: {sorted(missing)}")
    df.kickoff = pd.to_datetime(df.kickoff, utc=True); df = df.sort_values("kickoff").reset_index(drop=True)
    features = cols(list(GROUPS))
    if missing := set(features) - set(df.columns): raise SystemExit(f"feature export missing: {sorted(missing)}")
    pred = walk_forward(df, features, args.min_train)
    if pred.empty: raise SystemExit("not enough chronological rows to backtest")
    overall = scores(pred, pred.prob, pred.margin)
    by_season = {str(s): scores(x, x.prob, x.margin) for s, x in pred.groupby("season")}
    ablation = []
    for group in GROUPS:
        x = walk_forward(df, [f for f in features if f not in GROUPS[group]], args.min_train); m = scores(x, x.prob, x.margin)
        ablation.append({"removed": group, "metrics": m, "log_loss_change": round(m["log_loss"] - overall["log_loss"], 4), "su_accuracy_change": round(m["su_accuracy"] - overall["su_accuracy"], 4)})
    _, _, win, margin = fit_predict(df, df.iloc[:1], features)
    v1 = scores(pred, sigmoid(pred.legacy_v1_margin / 6.5), pred.legacy_v1_margin)
    market = pred.dropna(subset=["closing_spread"])
    baselines = {"always_home": scores(pred, np.repeat(.5, len(pred)), np.zeros(len(pred))), "afi_v1_recency": v1}
    if len(market): baselines["closing_line"] = scores(market, sigmoid(market.closing_spread / 6.5), market.closing_spread)
    promoted = overall["log_loss"] < v1["log_loss"] and overall["su_accuracy"] >= v1["su_accuracy"]
    artifact = {"version": args.version, "generated_at": datetime.now(timezone.utc).isoformat(), "algorithm": "regularized logistic regression + ridge margin regression", "feature_groups": list(GROUPS), "features": features, "coefficients": {"win_probability": coefficient_map(win, features), "home_margin": coefficient_map(margin, features, False)}, "metrics": {"status": "walk_forward_complete", "overall": overall, "by_season": by_season, "baselines": baselines, "calibration": calibration(pred)}, "ablation": ablation, "promotion": {"live": promoted, "compared_to": "afi_v1_recency", "reason": "Promoted only when OOS log loss improves and SU accuracy does not decline.", "decision": "promote" if promoted else "hold"}, "data_contract": {"point_in_time": True, "market_lines_are_evaluation_only": True, "first_oos_rows": int(len(pred)), "training_rows": int(len(df))}}
    pathlib.Path(args.output).write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"artifact": args.output, "promotion": artifact["promotion"], "overall": overall}, indent=2))
if __name__ == "__main__": main()
