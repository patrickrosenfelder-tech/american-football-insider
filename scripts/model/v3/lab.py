"""Factor lab: decide which factors earn a place in AFI v3, and how much they weigh.

For every factor group, on the same walk-forward setup as backtest.py (each week
predicted by a ridge model refit on earlier weeks only):
  add-one   base model + this group: does out-of-sample log loss improve?
  drop-one  base model - this group (for factors already in the base)
  luck      shuffle the group's values between games within each season N times and
            rerun; the share of shuffles that do as well as the real data is the
            p-value. A real factor should beat nearly all of them.
  split     greedy forward selection using only 2017-2021 results, then the chosen
            set is checked once on 2022-2026, which the selection never saw.
Weights are reported as points of home margin per 1 standard deviation of the factor,
fit separately on both halves so you can see whether they are stable.
"""
import argparse, json, pathlib
from math import erf
import numpy as np
import pandas as pd
from . import data, players as P

FEATURES = data.ROOT / ".cache" / "v3_features.csv"
OUT = data.ROOT / "v3" / "factor_lab.json"
ALPHA = 300.0
SIGMA = 13.4
norm_cdf = np.vectorize(lambda x: 0.5 * (1 + erf(x / np.sqrt(2))))

BASE = {
    "elo": ["elo_diff"], "home": ["home_field"],
    "roster_delta": [f"delta_{g}" for g in P.GROUPS], "roster_abs": [f"grp_{g}" for g in P.GROUPS],
    "efficiency": ["net_epa_matchup", "pass_matchup", "rush_matchup", "success_diff"],
    "pressure": ["pressure_matchup"], "rest": ["rest_diff", "short_week_diff"], "wind": ["wind_x_pass"], "division": ["div_game"],
}
CANDIDATES = {
    "unit_mismatch": ["pass_block_mismatch", "coverage_mismatch", "run_mismatch"],
    "coverage_scheme": ["coverage_matchup"],
    "scheme_pressure": ["scheme_pressure_matchup", "blitz_x_ttt"],
    "ftn_tendencies": ["pa_rate_diff", "motion_rate_diff"],
    "early_down_pass": ["early_pass_diff"],
    "ngs_qb": ["qb_cpoe_diff", "qb_ttt_diff", "qb_aggr_diff"],
    "ngs_receivers": ["separation_diff", "yac_oe_diff"],
    "questionable": ["q_starters_diff", "q_qb_diff", "q_dnp_diff"],
    "travel_timezone": ["travel_diff", "tz_diff", "west_early", "east_late"],
    "altitude": ["altitude"], "primetime": ["primetime_home"], "surface": ["surface_change"],
    "weather_extra": ["precip_x_pass", "dome_team_cold"],
    "coaching": ["new_coach_diff", "new_coach_early", "interim_coach_diff"],
    "referee": ["ref_home_bias"],
}


def prepare(df):
    df = df.copy()
    df["margin"] = df.home_score - df.away_score
    std = {g: df.loc[df.season == df.season.min(), f"home_grp_{g}"].std() for g in P.GROUPS}  # first season only
    z = lambda side, g: df[f"{side}_grp_{g}"] / std[g]
    relu = lambda x: x.clip(lower=0)
    df["pass_block_mismatch"] = relu(z("away", "DL") - z("home", "OL")) - relu(z("home", "DL") - z("away", "OL"))
    pg = lambda s: (z(s, "QB") + z(s, "WR") + z(s, "TE")) / 3; sec = lambda s: (z(s, "CB") + z(s, "S")) / 2
    df["coverage_mismatch"] = relu(pg("home") - sec("away")) - relu(pg("away") - sec("home"))
    run = lambda s: (z(s, "RB") + z(s, "OL")) / 2; front = lambda s: (z(s, "DL") + z(s, "LB")) / 2
    df["run_mismatch"] = relu(run("home") - front("away")) - relu(run("away") - front("home"))
    return df.dropna(subset=["margin"]).sort_values(["season", "week", "game_id"]).reset_index(drop=True)


def fit(x, y, alpha=ALPHA):
    mu, sd = x.mean(0), x.std(0); sd[sd == 0] = 1
    xs = (x - mu) / sd
    beta = np.linalg.solve(xs.T @ xs + alpha * np.eye(x.shape[1]), xs.T @ (y - y.mean()))
    return mu, sd, beta, y.mean()


def predict(model, x):
    mu, sd, beta, b0 = model
    return ((x - mu) / sd) @ beta + b0


def walk_forward(df, cols, start=2017, end=2100, refit_every=1):
    return walk_forward_np(df[cols].fillna(0).to_numpy(float), df, start, end, refit_every)


def walk_forward_np(x, df, start=2017, end=2100, refit_every=1):
    y = df.margin.to_numpy(float)
    key = (df.season * 100 + df.week).to_numpy()
    weeks = np.unique(key[(df.season >= start).to_numpy() & (df.season <= end).to_numpy()])
    pred = np.full(len(df), np.nan); model = None
    for i, k in enumerate(weeks):
        if model is None or i % refit_every == 0:
            tr = key < k; model = fit(x[tr], y[tr])
        te = key == k; pred[te] = predict(model, x[te])
    return pred


def score(df, pred, mask=None):
    ok = ~np.isnan(pred) if mask is None else (~np.isnan(pred) & mask)
    m, y = pred[ok], df.margin.to_numpy()[ok]
    d = y != 0
    p = np.clip(norm_cdf(m[d] / SIGMA), 1e-6, 1 - 1e-6); w = (y[d] > 0).astype(float)
    return {"games": int(ok.sum()), "log_loss": round(float(-(w * np.log(p) + (1 - w) * np.log(1 - p)).mean()), 5),
            "su_accuracy": round(float(((m[d] > 0) == (y[d] > 0)).mean()), 4), "margin_mae": round(float(np.abs(m - y).mean()), 3)}


def cols_of(groups, table):
    return [c for g in groups for c in table[g]]


def luck_test(df, base_cols, group_cols, n, rng, refit_every=1, start=2017, end=2100):
    real = score(df, walk_forward(df, base_cols + group_cols, start, end, refit_every))["log_loss"]
    x = df[base_cols + group_cols].fillna(0).to_numpy(float)
    g = np.arange(len(base_cols), len(base_cols) + len(group_cols))
    seasons = [np.flatnonzero(df.season.to_numpy() == s) for s in df.season.unique()]
    shuffled = []
    for _ in range(n):
        xs = x.copy()
        for idx in seasons:  # shuffle the group's values between games of the same season
            xs[np.ix_(idx, g)] = x[np.ix_(rng.permutation(idx), g)]
        shuffled.append(score(df, walk_forward_np(xs, df, start, end, refit_every))["log_loss"])
    shuffled = np.array(shuffled)
    return {"real_log_loss": real, "shuffled_mean": round(float(shuffled.mean()), 5),
            "p_value": round(float((np.sum(shuffled <= real) + 1) / (n + 1)), 4), "shuffles": n}


def weights(df, cols, seasons):
    sub = df[df.season.isin(seasons)]
    x = sub[cols].fillna(0).to_numpy(float); model = fit(x, sub.margin.to_numpy(float))
    return {c: round(float(b), 3) for c, b in zip(cols, model[2])}  # points per 1 SD


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--features", default=str(FEATURES)); ap.add_argument("--shuffles", type=int, default=200)
    ap.add_argument("--alt", action="append", default=[], help="name=path of an alternative feature build to compare, e.g. no_opp_adjust=...csv")
    ap.add_argument("--output", default=str(OUT)); a = ap.parse_args()
    rng = np.random.default_rng(7)
    df = prepare(pd.read_csv(a.features))
    base_cols = cols_of(BASE, BASE)
    base = score(df, walk_forward(df, base_cols))
    print("base", base, flush=True)
    report = {"method": __doc__.strip(), "alpha": ALPHA, "base": base, "add_one": {}, "drop_one": {}, "luck": {}, "alternatives": {}}
    for name, cols in CANDIDATES.items():
        r = score(df, walk_forward(df, base_cols + cols))
        r["log_loss_change"] = round(r["log_loss"] - base["log_loss"], 5)
        report["add_one"][name] = r; print("add", name, r, flush=True)
    for name in BASE:
        cols = [c for g in BASE if g != name for c in BASE[g]]
        r = score(df, walk_forward(df, cols)); r["log_loss_change"] = round(r["log_loss"] - base["log_loss"], 5)
        report["drop_one"][name] = r; print("drop", name, r, flush=True)
    for name, cols in list(CANDIDATES.items()) + [(f"base:{k}", v) for k, v in BASE.items()]:
        others = [c for c in base_cols if c not in cols]
        report["luck"][name] = luck_test(df, others, cols, a.shuffles, rng); print("luck", name, report["luck"][name], flush=True)
    # ---- split: select on 2017-2021 only, confirm on 2022+ ----
    chosen, remaining = list(BASE), dict(CANDIDATES)
    best = score(df, walk_forward(df, cols_of(chosen, BASE), 2017, 2021))["log_loss"]
    table = {**BASE, **CANDIDATES}
    steps = []
    while remaining:
        trials = {g: score(df, walk_forward(df, cols_of(chosen + [g], table), 2017, 2021))["log_loss"] for g in remaining}
        g, ll = min(trials.items(), key=lambda kv: kv[1])
        if ll > best - 0.0005: break
        chosen.append(g); best = ll; remaining.pop(g); steps.append({"added": g, "log_loss_2017_2021": ll})
    late = df.season >= 2022
    sel_cols, base_only = cols_of(chosen, table), base_cols
    report["split"] = {"selected_on_2017_2021": steps, "chosen_groups": chosen,
                       "confirm_2022_plus": {"base": score(df, walk_forward(df, base_only), late.to_numpy()),
                                             "selected": score(df, walk_forward(df, sel_cols), late.to_numpy())}}
    print("split", report["split"], flush=True)
    report["weights"] = {"2017_2021": weights(df, sel_cols, range(2016, 2022)), "2022_plus": weights(df, sel_cols, range(2022, 2100)),
                         "all": weights(df, sel_cols, range(2016, 2100))}
    for alt in a.alt:
        name, path = alt.split("=", 1)
        d2 = prepare(pd.read_csv(path))
        report["alternatives"][name] = {"base": score(d2, walk_forward(d2, base_cols)), "selected": score(d2, walk_forward(d2, sel_cols))}
        print("alt", name, report["alternatives"][name], flush=True)
    pathlib.Path(a.output).write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
