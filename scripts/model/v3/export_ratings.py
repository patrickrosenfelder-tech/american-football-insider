"""Export current AFI v3 base Elo ratings for the site (/elo).

base Elo = results Elo + roster adjustment. The roster adjustment is each position
group's strength (available players, this week) minus the league average that week,
times the group's learned weight, converted at 25 Elo per point of margin. Weights
come from the v3 core model refit on every played game.
"""
import argparse, json, pathlib
import numpy as np
import pandas as pd
from . import backtest as B, data, elo as E, features as F, players as P

OUT = data.ROOT / "v3" / "ratings_current.json"
VERSION = "v3.2"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--output", default=str(OUT)); ap.add_argument("--refresh", action="store_true"); a = ap.parse_args()
    df, _, _ = F.build(upcoming=True, refresh_current=a.refresh)
    df["margin"] = df.home_score - df.away_score
    season = int(df.season.max())
    unplayed = df[(df.season == season) & df.margin.isna()]
    week = int(unplayed.week.min()) if len(unplayed) else int(df[df.season == season].week.max())
    # Future weeks have no roster/availability data yet; only this week and earlier are meaningful.
    cur = df[(df.season == season) & (df.week <= week)].copy()
    cols = B.SETS[B.CORE]
    played = df.dropna(subset=["margin"])
    model = B.ridge(played[cols], played.margin)
    sc, rg = model.named_steps["standardscaler"], model.named_steps["ridge"]
    per_unit = lambda c: rg.coef_[cols.index(c)] / sc.scale_[cols.index(c)]
    weight = {g: per_unit(f"grp_{g}") + per_unit(f"delta_{g}") for g in P.GROUPS}

    rows = []
    for _, r in cur.iterrows():
        for side in ("home", "away"):
            rows.append({"week": int(r.week), "game_id": r.game_id, "played": pd.notna(r.margin), "team": r[side], "team_espn": r[f"{side}_espn"],
                         "results_elo": float(r[f"{side}_elo"]), **{g: float(r[f"{side}_grp_{g}"]) for g in P.GROUPS}})
    t = pd.DataFrame(rows)
    sd = {g: float(t[g].std()) for g in P.GROUPS}
    for g in P.GROUPS:
        t[g] = (t[g] - t.groupby("week")[g].transform("mean")) * weight[g] * E.ELO_PER_POINT
    t["roster_adj"] = t[P.GROUPS].sum(axis=1)
    t["base_elo"] = t.results_elo + t.roster_adj
    teams = []
    for team, h in t.sort_values("week").groupby("team"):
        last = h.iloc[-1]
        teams.append({"team": team, "team_espn": last.team_espn, "week": int(last.week), "results_elo": round(last.results_elo),
                      "roster_adj": round(last.roster_adj), "base_elo": round(last.base_elo),
                      "groups": {g: round(float(last[g]), 1) for g in P.GROUPS},
                      "history": [{"week": int(x.week), "base_elo": round(x.base_elo), "results_elo": round(x.results_elo)} for x in h.itertuples()]})
    teams.sort(key=lambda x: -x["base_elo"])
    for i, x in enumerate(teams): x["rank"] = i + 1

    this_week = cur[cur.week == week]
    pred = model.predict(this_week[cols]) if len(this_week) else []
    sigma = float(np.sqrt(np.mean((played.margin - model.predict(played[cols])) ** 2)))
    base = {(x["team"]): x["base_elo"] for x in teams}
    from math import erf
    games = [{"game_id": r.game_id, "kickoff": r.kickoff, "home": r.home_espn, "away": r.away_espn,
              "home_base_elo": base.get(r.home), "away_base_elo": base.get(r.away),
              "v3_home_margin": round(float(m), 1), "v3_home_win_prob": round(0.5 * (1 + erf(m / sigma / np.sqrt(2))), 3)}
             for r, m in zip(this_week.itertuples(), pred) if pd.isna(r.margin)]
    out = {"model_version": VERSION, "generated_at": pd.Timestamp.now(tz="UTC").isoformat(), "season": season, "week": week,
           "data_through": played.kickoff.max(), "method": __doc__.strip(), "elo_per_point": E.ELO_PER_POINT,
           # Elo swing of a 1-standard-deviation better position group (this season's teams).
           "position_factors_elo_per_sd": {g: round(float(weight[g] * sd[g] * E.ELO_PER_POINT), 1) for g in P.GROUPS},
           "teams": teams, "games": games}
    pathlib.Path(a.output).write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps({"artifact": a.output, "season": season, "week": week, "teams": len(teams), "games": len(games)}))


if __name__ == "__main__":
    main()
