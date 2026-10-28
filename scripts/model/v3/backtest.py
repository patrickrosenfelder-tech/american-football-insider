"""Walk-forward backtest of AFI v3 variants against Vegas (closing lines).

Every week is predicted by models refit only on earlier weeks. Variants:
  core_*   no market input at all (elo -> +roster -> +matchup)
  A_blend  core prediction blended with the market; blend weights are fit on the
           core model's own earlier out-of-sample predictions (no in-sample peeking)
  B_m{m}   market spread fed in directly with a fixed multiplier m; the other
           features are fit to the part of the result the scaled line misses
  B_free   spread as an ordinary learned feature
  B_*_exc  B with exceptions: a different multiplier early in the season and/or
           when a team's starting QB situation changed (|delta_QB| >= 3 points)
Win probability for every variant is Phi(margin / sigma), sigma fit on training rows.
"""
import argparse, json, pathlib
import numpy as np
import pandas as pd
from math import erf
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from . import data, players as P

FEATURES = data.ROOT / ".cache" / "v3_features.csv"
OUT = data.ROOT / "v3" / "backtest_v3.json"
ROSTER = [f"delta_{g}" for g in P.GROUPS]
ABS = [f"grp_{g}" for g in P.GROUPS]
MATCHUP = ["net_epa_matchup", "pass_matchup", "rush_matchup", "pressure_matchup", "success_diff", "rest_diff",
           "short_week_diff", "wind_x_pass", "div_game"]
# v3.1 keeps only factors that passed the factor lab's shuffle test (p < 0.05, see
# factor_lab.json): Elo, roster delta/abs, efficiency, pressure and NGS QB style.
LAB_KEPT = ["net_epa_matchup", "pass_matchup", "rush_matchup", "success_diff", "pressure_matchup", "qb_cpoe_diff", "qb_ttt_diff", "qb_aggr_diff"]
SETS = {
    "core_elo": ["elo_diff", "home_field"],
    "core_elo_roster": ["elo_diff", "home_field"] + ROSTER,
    "core_elo_roster_abs": ["elo_diff", "home_field"] + ROSTER + ABS,
    "core_full": ["elo_diff", "home_field"] + ROSTER + ABS + MATCHUP,
    "core_v31": ["elo_diff", "home_field"] + ROSTER + ABS + LAB_KEPT,
}
CORE = "core_v31"
MULTIPLIERS = [0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
EXCEPTIONS = [("early", -0.2), ("early", 0.1), ("qb", -0.2), ("qb", -0.4)]
ALPHA = 300.0  # ridge strength; 3/10/30/100/300/1000 tried, 300 best for core_full
norm_cdf = np.vectorize(lambda x: 0.5 * (1 + erf(x / np.sqrt(2))))


def market_prob(r):
    """De-vigged moneyline when posted, else the spread through the same normal curve."""
    h, a = r.home_moneyline, r.away_moneyline
    if pd.notna(h) and pd.notna(a) and h != 0 and a != 0:
        imp = lambda ml: 100 / (ml + 100) if ml > 0 else -ml / (-ml + 100)
        ph, pa = imp(h), imp(a)
        return ph / (ph + pa)
    return np.nan


def ridge(x, y):
    return make_pipeline(StandardScaler(), Ridge(alpha=ALPHA)).fit(x, y)


def fit_sigma(pred, y):
    return float(max(10.0, np.sqrt(np.mean((y - pred) ** 2))))


def multiplier(test, base, exc):
    m = np.full(len(test), base)
    if exc is None: return m
    kind, shift = exc
    mask = test.week.to_numpy() <= 4 if kind == "early" else np.abs(test.delta_QB.to_numpy()) >= 3
    m[mask] = np.clip(base + shift, 0, 1)
    return m


def walk_forward(df, min_train_weeks=17):
    keys = df[["season", "week"]].drop_duplicates().sort_values(["season", "week"]).itertuples(index=False)
    keys = list(keys)
    preds = []
    for i, (season, week) in enumerate(keys):
        if i < min_train_weeks: continue
        train = df[(df.season < season) | ((df.season == season) & (df.week < week))]
        train = train.dropna(subset=["margin"])
        test = df[(df.season == season) & (df.week == week)].dropna(subset=["margin"])
        if test.empty: continue
        out = test[["game_id", "season", "week", "home", "away", "margin", "spread_line", "mkt_prob", "delta_QB"]].copy()
        y, spread_tr, spread_te = train.margin.to_numpy(), train.spread_line.fillna(0).to_numpy(), test.spread_line.fillna(0).to_numpy()
        for name, cols in SETS.items():
            model = ridge(train[cols], y)
            out[f"{name}_m"] = model.predict(test[cols])
            out[f"{name}_s"] = fit_sigma(model.predict(train[cols]), y)
        cols = SETS[CORE]
        free = ridge(train[cols + ["spread_line"]].fillna(0), y)
        out["B_free_m"] = free.predict(test[cols + ["spread_line"]].fillna(0)); out["B_free_s"] = fit_sigma(free.predict(train[cols + ["spread_line"]].fillna(0)), y)
        for m in MULTIPLIERS:
            for exc in [None] + EXCEPTIONS:
                name = f"B_m{m}" + ("" if exc is None else f"_{exc[0]}{exc[1]:+.1f}")
                mt, me = multiplier(train, m, exc), multiplier(test, m, exc)
                resid = ridge(train[cols], y - mt * spread_tr)
                fit_tr = mt * spread_tr + resid.predict(train[cols])
                out[f"{name}_m"] = me * spread_te + resid.predict(test[cols])
                out[f"{name}_s"] = fit_sigma(fit_tr, y)
        preds.append(out)
    p = pd.concat(preds, ignore_index=True)
    # Variant A: blend weight per week from the core model's *earlier* out-of-sample rows only.
    p = p.sort_values(["season", "week"]).reset_index(drop=True)
    w_list, s_list = [], []
    for (season, week), idx in p.groupby(["season", "week"]).groups.items():
        hist = p[(p.season < season) | ((p.season == season) & (p.week < week))].dropna(subset=["spread_line"])
        if len(hist) < 256:
            w, s = 0.5, 13.5
        else:
            a, b = hist[f"{CORE}_m"].to_numpy(), hist.spread_line.to_numpy()
            # least-squares weight on core vs market, constrained to [0, 1]
            d = a - b; w = float(np.clip(np.dot(d, hist.margin.to_numpy() - b) / max(np.dot(d, d), 1e-9), 0, 1))
            s = fit_sigma(w * a + (1 - w) * b, hist.margin.to_numpy())
        w_list += [(i, w) for i in idx]; s_list += [(i, s) for i in idx]
    w = pd.Series(dict(w_list)); s = pd.Series(dict(s_list))
    p["A_blend_m"] = w * p[f"{CORE}_m"] + (1 - w) * p.spread_line.fillna(p[f"{CORE}_m"])
    p["A_blend_s"] = s; p["A_weight"] = w
    p["vegas_m"] = p.spread_line; p["vegas_s"] = 13.5
    return p


def grade(p, name):
    m, s = p[f"{name}_m"].to_numpy(), p[f"{name}_s"].to_numpy()
    prob = norm_cdf(m / s) if name != "vegas" else p.mkt_prob.fillna(pd.Series(norm_cdf(m / s), index=p.index)).to_numpy()
    y = p.margin.to_numpy(); decided = y != 0; win = (y > 0).astype(float)
    pr = np.clip(prob[decided], 1e-6, 1 - 1e-6)
    res = {"games": int(len(p)), "su_accuracy": round(float(((m[decided] > 0) == (y[decided] > 0)).mean()), 4),
           "log_loss": round(float(-(win[decided] * np.log(pr) + (1 - win[decided]) * np.log(1 - pr)).mean()), 4),
           "brier": round(float(((pr - win[decided]) ** 2).mean()), 4), "margin_mae": round(float(np.abs(m - y).mean()), 3)}
    if name != "vegas":
        line = p.spread_line.to_numpy(); ok = ~np.isnan(line)
        edge, cover = m[ok] - line[ok], y[ok] - line[ok]
        for label, mask in [("ats", np.abs(edge) > 0), ("ats_edge2", np.abs(edge) >= 2), ("ats_edge3", np.abs(edge) >= 3)]:
            e, c = edge[mask], cover[mask]
            w_, l_, push = int(((e > 0) & (c > 0) | (e < 0) & (c < 0)).sum()), int(((e > 0) & (c < 0) | (e < 0) & (c > 0)).sum()), int((c == 0).sum())
            res[label] = {"w": w_, "l": l_, "p": push, "pct": round(100 * w_ / max(w_ + l_, 1), 1), "roi_pct": round(100 * (w_ * 100 / 110 - l_) / max(w_ + l_, 1), 1)}
    return res


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--features", default=str(FEATURES)); ap.add_argument("--v2", default=str(data.ROOT / ".cache" / "v2_oos.csv"))
    ap.add_argument("--output", default=str(OUT)); a = ap.parse_args()
    df = pd.read_csv(a.features)
    df["margin"] = df.home_score - df.away_score
    df["mkt_prob"] = df.apply(market_prob, axis=1)
    df = df.sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    p = walk_forward(df)
    names = list(SETS) + ["A_blend", "B_free"] + sorted({c[:-2] for c in p.columns if c.startswith("B_m") and c.endswith("_m")}) + ["vegas"]
    v2 = pathlib.Path(a.v2)
    if v2.exists():
        v = pd.read_csv(v2); p = p.merge(v, on="game_id", how="left")
        p["v2_m"], p["v2_s"] = p.v2_margin, 13.5
        p = p.dropna(subset=["v2_m"]); names.insert(0, "v2")
    p = p.dropna(subset=["spread_line"])
    results = {n: grade(p, n) for n in names}
    by_season = {n: {str(s): grade(x, n) for s, x in p.groupby("season")} for n in ["v2", "core_full", CORE, "A_blend", "B_m1.0", "vegas"] if n in names}
    report = {"generated_at": pd.Timestamp.now(tz="UTC").isoformat(), "oos_games": int(len(p)), "seasons": sorted(int(s) for s in p.season.unique()),
              "method": __doc__.strip(), "results": results, "by_season": by_season,
              "blend_weight_on_core_latest": round(float(p.A_weight.iloc[-1]), 3)}
    pathlib.Path(a.output).write_text(json.dumps(report, indent=2) + "\n")
    p.to_csv(data.ROOT / ".cache" / "v3_oos.csv", index=False)
    table = pd.DataFrame({n: {k: v for k, v in r.items() if not isinstance(v, dict)} | {"ats%": r.get("ats", {}).get("pct"), "ats3%": r.get("ats_edge3", {}).get("pct"), "ats3_n": (r.get("ats_edge3", {}).get("w", 0) + r.get("ats_edge3", {}).get("l", 0)) or None} for n, r in results.items()}).T
    print(table.to_string())


if __name__ == "__main__":
    main()
