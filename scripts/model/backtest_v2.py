#!/usr/bin/env python3
"""Walk-forward v2 backtest for the /picks table: 2025 full season + 2026 weeks played.

Every game is predicted by a model refit on games that kicked off before it
(train.walk_forward semantics), using the point-in-time feature export. The
totals model is a ridge on decay-weighted points for/against, refit weekly on
earlier weeks only. Closing lines are used for grading, never as features.
"""
import argparse, json, pathlib
from collections import defaultdict
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
import train

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "backtest_v2.json"
HALF_LIFE = 5

def weighted(x):
    if not x: return np.nan
    w = np.exp(-np.log(2) * np.arange(len(x) - 1, -1, -1) / HALF_LIFE); return float(np.average(x, weights=w))

def scoring_features(games):
    """Point-in-time scoring history per team (all prior games, decayed) and season-to-date means for v1."""
    games = games.sort_values(["kickoff", "game_id"]); pf, pa = defaultdict(list), defaultdict(list); season_pts = defaultdict(list); rows = {}
    for g in games.itertuples(index=False):
        h, a, s = g.home_team, g.away_team, g.season
        def v1(team):
            cur = season_pts[(team, s)] or season_pts[(team, s - 1)]
            return (np.mean([x[0] for x in cur]), np.mean([x[1] for x in cur])) if cur else (np.nan, np.nan)
        (hpf1, hpa1), (apf1, apa1) = v1(h), v1(a)
        rows[g.game_id] = {"h_pf": weighted(pf[h]), "h_pa": weighted(pa[h]), "a_pf": weighted(pf[a]), "a_pa": weighted(pa[a]),
                           "v1_total": ((hpf1 + apa1) + (apf1 + hpa1)) / 2}
        if pd.notna(g.home_score):
            pf[h].append(g.home_score); pa[h].append(g.away_score); pf[a].append(g.away_score); pa[a].append(g.home_score)
            season_pts[(h, s)].append((g.home_score, g.away_score)); season_pts[(a, s)].append((g.away_score, g.home_score))
    return pd.DataFrame.from_dict(rows, orient="index")

def predict_totals(df, seasons):
    cols = ["h_pf", "h_pa", "a_pf", "a_pa"]; out = pd.Series(np.nan, index=df.index)
    for (season, week), test in df[df.season.isin(seasons)].groupby(["season", "week"]):
        tr = df[(df.kickoff < test.kickoff.min()) & df.actual_total.notna()].dropna(subset=cols)
        model = Ridge(alpha=5.0).fit(tr[cols], tr.actual_total)
        out[test.index] = model.predict(test[cols].fillna(tr[cols].mean()))
    return out

def result(pick_home_or_over, outcome):
    """outcome > 0: home/over wins, < 0: away/under wins, 0: push."""
    if pd.isna(outcome): return None
    return "P" if outcome == 0 else ("W" if (outcome > 0) == bool(pick_home_or_over) else "L")

def grade(df):
    m = df.home_margin; spread = df.closing_spread; tot = df.actual_total
    rows = pd.DataFrame(index=df.index)
    rows["v2_su"] = [None if mm == 0 else ("W" if (p >= .5) == (mm > 0) else "L") for p, mm in zip(df.prob, m)]
    rows["v2_ats"] = [None if pd.isna(s) else result(pm > s, mm - s) for pm, s, mm in zip(df.margin, spread, m)]
    rows["v2_ou"] = [None if pd.isna(l) else result(pt > l, t - l) for pt, l, t in zip(df.v2_total, df.closing_total, tot)]
    rows["v1_su"] = [None if mm == 0 else ("W" if (v >= 0) == (mm > 0) else "L") for v, mm in zip(df.legacy_v1_margin, m)]
    rows["v1_ats"] = [None if pd.isna(s) else result(v > s, mm - s) for v, s, mm in zip(df.legacy_v1_margin, spread, m)]
    rows["v1_ou"] = [None if pd.isna(l) or pd.isna(v) else result(v > l, t - l) for v, l, t in zip(df.v1_total, df.closing_total, tot)]
    rows["vegas_su"] = [None if mm == 0 or pd.isna(s) or s == 0 else ("W" if (s > 0) == (mm > 0) else "L") for s, mm in zip(spread, m)]
    rows["home_su"] = [None if mm == 0 else ("W" if mm > 0 else "L") for mm in m]
    rows["home_ats"] = [None if pd.isna(s) else result(True, mm - s) for s, mm in zip(spread, m)]
    return rows

def rec(series):
    s = [x for x in series if x in ("W", "L", "P")]; w, l, p = s.count("W"), s.count("L"), s.count("P")
    return {"w": w, "l": l, "p": p, "pct": round(100 * w / (w + l), 1) if w + l else None}

FIELDS = ["v2_su", "v2_ats", "v2_ou", "v1_su", "v1_ats", "v1_ou", "vegas_su", "home_su", "home_ats"]
def table(rows):
    return {"games": int(len(rows)), **{f: rec(rows[f]) for f in FIELDS}}

def main():
    p = argparse.ArgumentParser(); p.add_argument("--input", default=str(ROOT / "features_2016_2026.csv")); p.add_argument("--games", default=str(ROOT / ".cache" / "games.csv"))
    p.add_argument("--seasons", default="2025,2026"); p.add_argument("--min-train", type=int, default=96); p.add_argument("--output", default=str(OUT)); a = p.parse_args()
    seasons = [int(s) for s in a.seasons.split(",")]
    df = pd.read_csv(a.input); df.kickoff = pd.to_datetime(df.kickoff, utc=True); df = df.sort_values("kickoff").reset_index(drop=True)
    features = train.cols(list(train.GROUPS))
    # Fit only on rows before each kickoff, then keep the requested seasons.
    pred = []
    for kickoff, test in df[df.season.isin(seasons)].groupby("kickoff", sort=True):
        tr = df[df.kickoff < kickoff]
        prob, margin, _, _ = train.fit_predict(tr, test, features)
        out = test.copy(); out["prob"] = prob; out["margin"] = margin; pred.append(out)
    pred = pd.concat(pred)
    games = pd.read_csv(a.games); games = games[(games.game_type == "REG") & (games.season >= 2002)].copy()
    games["kickoff"] = pd.to_datetime(games.gameday.astype(str) + " " + games.gametime.fillna("13:00"), utc=True, errors="coerce")
    sc = scoring_features(games); sc["actual_total"] = games.set_index("game_id").eval("home_score + away_score")
    allrows = df.join(sc, on="game_id"); allrows["v2_total"] = predict_totals(allrows, seasons)
    pred = pred.join(allrows.set_index("game_id")[["v2_total", "v1_total", "actual_total"]], on="game_id")
    rows = grade(pred); rows["season"] = pred.season; rows["week"] = pred.week
    vegas = pred.dropna(subset=["closing_spread"]); v_prob = train.sigmoid(vegas.closing_spread / 6.5)
    out = {"model_version": json.loads((ROOT / "model_v2.json").read_text())["version"],
           "generated_at": datetime.now(timezone.utc).isoformat(),
           "data_through": pred.kickoff.max().isoformat(),
           "method": "Walk-forward: each game is predicted by v2 refit on games that kicked off before it, using point-in-time features (no look-ahead). Totals: ridge on decay-weighted points for/against, refit weekly on earlier weeks. Graded against nflverse closing lines; pushes and ties excluded from percentages.",
           "seasons": [], "calibration": {
               "v2": train.scores(pred, pred.prob.to_numpy(), pred.margin.to_numpy()),
               "vegas": train.scores(vegas, v_prob.to_numpy(), vegas.closing_spread.to_numpy())}}
    for season in sorted(seasons, reverse=True):
        r = rows[rows.season == season]
        out["seasons"].append({"season": season, "weeks": [{"week": int(w), **table(x)} for w, x in r.groupby("week")], "total": table(r)})
    tot = table(rows); out["total"] = tot
    beats = tot["v2_su"]["pct"] > tot["vegas_su"]["pct"]
    ats = tot["v2_ats"]["pct"]
    out["verdict"] = {"beats_vegas_su": bool(beats), "ats_above_breakeven": bool(ats > 52.4),
        "text": (f"v2 picked {tot['v2_su']['pct']}% of winners vs {tot['vegas_su']['pct']}% for the Vegas closing favorite"
                 + (" — v2 beats Vegas straight up." if beats else " — v2 does not beat Vegas.")
                 + f" Against the closing spread v2 is {ats}% ({'above' if ats > 52.4 else 'below'} the 52.4% needed to break even at -110).")}
    pathlib.Path(a.output).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"artifact": a.output, "total": tot, "verdict": out["verdict"]["text"]}, indent=1))

if __name__ == "__main__": main()
