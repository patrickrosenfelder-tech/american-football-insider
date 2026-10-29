"""Build one point-in-time v3 feature row per regular-season game.

Layer 1, base strength (what a team *is* this week):
  results Elo (moves with every final score) + roster delta per position group
  (current available roster vs the roster that earned that Elo).
Layer 2, matchup (how these two teams fit together this week):
  home field, rest, efficiency matchups from tendencies, pressure matchup,
  weather x passing tendency, dome team in the cold.
Market columns (spread, total, moneyline) are carried for evaluation and for the
odds variants in backtest.py; the no-odds model never sees them.
"""
import argparse, pathlib, re
import numpy as np
import pandas as pd
from . import data, elo, factors as X, players as P

OUT = data.ROOT / ".cache" / "v3_features.csv"
TEAM_STATS = ["off_epa", "off_pass_epa", "off_rush_epa", "off_success", "pass_oe", "early_pass", "off_sack_rate",
              "def_epa", "def_pass_epa", "def_rush_epa", "def_sack_rate", "plays"]
ALL_TEAM_STATS = TEAM_STATS + X.SCHEME + ["separation", "yac_oe"]
QB_NGS = ["cpoe", "ttt", "aggr"]
# Opponent-adjusted player grades: off. In the factor lab (2017-2026) they made log loss
# slightly worse (0.6242 -> 0.6245), so grades use raw per-snap production.
OPP_ADJUST = False
ESPN = {"LA": "LAR", "WAS": "WSH"}
# nflverse uses OAK/SD/STL for relocated teams in early seasons; ratings follow the franchise.
FRANCHISE = {"OAK": "LV", "SD": "LAC", "STL": "LA"}


def team_game_stats(pbp):
    p = pbp[pbp.posteam.notna() & pbp.epa.notna() & pbp.qb_kneel.ne(1) & pbp.qb_spike.ne(1) & pbp.two_point_attempt.ne(1)].copy()
    p["is_pass"], p["is_rush"] = p["pass"].eq(1), p.rush.eq(1)
    p["success"] = (p.epa > 0).astype(float)
    p["early"] = p.down.isin([1, 2])

    def side(team_col):
        g = p.groupby(["game_id", team_col])
        out = pd.DataFrame({
            "epa": g.epa.mean(),
            "pass_epa": p[p.is_pass].groupby(["game_id", team_col]).epa.mean(),
            "rush_epa": p[p.is_rush].groupby(["game_id", team_col]).epa.mean(),
            "success": g.success.mean(),
            "pass_oe": g.pass_oe.mean(),
            "early_pass": p[p.early].groupby(["game_id", team_col]).is_pass.mean(),
            "sack_rate": p[p.qb_dropback.eq(1)].groupby(["game_id", team_col]).sack.mean(),
            "plays": g.size(),
        })
        out.index.names = ["game_id", "team"]
        return out

    off, dfn = side("posteam"), side("defteam")
    s = off.add_prefix("off_")[["off_epa", "off_pass_epa", "off_rush_epa", "off_success", "off_sack_rate"]]
    s["pass_oe"], s["early_pass"], s["plays"] = off.pass_oe, off.early_pass, off.plays
    for k in ["epa", "pass_epa", "rush_epa", "sack_rate"]: s[f"def_{k}"] = dfn[k]
    return s.reset_index()


def precipitation(text):
    return int(bool(re.search(r"rain|snow|shower|sleet|drizzle", str(text), re.I)) and not re.search(r"0% chance|no rain", str(text), re.I))


class Decayed:
    """Decay-weighted running mean per key (team), used for tendencies and typical roster strength."""

    def __init__(self, columns):
        self.columns, self.sum, self.w = columns, {}, {}

    def decay(self, weeks):
        f = 0.5 ** (weeks / P.HALF_LIFE_WEEKS)
        for k in self.sum: self.sum[k] *= f; self.w[k] *= f

    def get(self, key):
        if key not in self.sum: return pd.Series(np.nan, index=self.columns)
        return self.sum[key] / self.w[key].where(self.w[key] > 0)

    def add(self, key, values):
        v = pd.Series(values, index=self.columns, dtype=float)
        ok = v.notna()
        prev_s = self.sum.get(key, pd.Series(0.0, index=self.columns))
        prev_w = self.w.get(key, pd.Series(0.0, index=self.columns))
        self.sum[key] = prev_s + v.where(ok, 0.0)
        self.w[key] = prev_w + ok.astype(float)


def build(first=2013, out_start=2016, last=None, refresh_current=False, upcoming=False):
    last = last or pd.Timestamp.now(tz="UTC").year
    games = data.games(refresh=refresh_current)
    games = games[games.season.between(1999, last)].copy()
    for col in ["home_team", "away_team"]: games[col] = games[col].replace(FRANCHISE)
    elo_pre, _ = elo.run(games, elo.DEFAULT)
    pbp, snaps, rosters, injuries = P.load_inputs(first, last, refresh_current)
    for frame, cols in [(pbp, ["home_team", "away_team", "posteam", "defteam"]), (snaps, ["team", "opponent"]), (rosters, ["team"]), (injuries, ["team"])]:
        for c in cols:
            if c in frame: frame[c] = frame[c].replace(FRANCHISE)
    pg = P.player_games(pbp, snaps, rosters)
    replacement = P.replacement_levels(pg, range(first, out_start))
    avail = P.availability(rosters, injuries)
    avail_by = {k: list(v) for k, v in avail.groupby(["season", "week", "team"]).gsis_id}
    q = injuries[injuries.report_status.eq("Questionable")].dropna(subset=["gsis_id"])
    questionable = {k: dict(zip(v.gsis_id, v.practice_status.fillna(""))) for k, v in q.groupby(["season", "week", "team"])}
    stats = team_game_stats(pbp)
    scheme = X.scheme_stats(pbp, first, last)
    for c in ["team"]: scheme[c] = scheme[c].replace(FRANCHISE)
    stats = stats.merge(scheme, on=["game_id", "team"], how="left")
    gw = pbp.drop_duplicates("game_id")[["game_id", "season", "week"]]
    rec = X.ngs_team_receiving(); rec["team"] = rec.team.replace(FRANCHISE)
    stats = stats.merge(gw, on="game_id", how="left").merge(rec, on=["season", "week", "team"], how="left")
    ngs = X.ngs_qb()
    ngs_by = {k: v for k, v in ngs.groupby(["season", "week"])}
    weather = pbp.drop_duplicates("game_id").set_index("game_id")[["weather"]]
    teams_of = dict(zip(games.game_id, zip(games.home_team, games.away_team)))

    ratings, tend, typical = P.Ratings(replacement), Decayed(ALL_TEAM_STATS), Decayed(P.GROUPS)
    qbd, sit = Decayed(QB_NGS), X.Situational()
    sched = games[games.season.between(first, last)]
    rows, depth_out, prev = [], {}, None
    for (season, week), wk in sched.groupby(["season", "week"], sort=True):
        if prev is not None:
            gap = 1.0 if season == prev[0] else 1.0 + P.OFFSEASON_WEEKS
            ratings.decay(gap); tend.decay(gap); typical.decay(gap); qbd.decay(gap)
        if prev is None or season != prev[0]: sit.new_season(season)
        prev = (season, week)
        snap = ratings.snapshot()
        played = wk.home_score.notna()
        if not upcoming and not played.any(): break
        fielded = {}  # pre-game strength of each team that actually played this week
        for g in wk.itertuples(index=False):
            if not upcoming and np.isnan(g.home_score): continue
            sides = {}
            for team, qb in [(g.home_team, g.home_qb_id), (g.away_team, g.away_qb_id)]:
                ids = avail_by.get((season, week, team), [])
                s = snap.copy()
                if isinstance(qb, str) and qb in s.index:
                    # The named starter takes the QB snaps; other QBs stay as depth.
                    s.loc[s.group.eq("QB"), "share"] = 0.0
                    s.loc[qb, "share"] = 1.0
                    if qb not in ids: ids = ids + [qb]
                strength, depth = P.group_strength(s, ids)
                extra = questionable_load(depth, questionable.get((season, week, team), {}))
                extra.update(qbd.get(qb).to_dict() if isinstance(qb, str) else {k: np.nan for k in QB_NGS})
                sides[team] = (strength, typical.get(team), tend.get(team), extra)
                depth_out[(g.game_id, team)] = depth
                if not np.isnan(g.home_score): fielded[(g.game_id, team)] = strength
            srow = sit.row(g)
            if season < out_start: continue
            rows.append(feature_row(g, sides, elo_pre[g.game_id], weather, srow))
        # ---- after this week's games: learn from them ----
        wk_ids = set(wk.game_id)
        week_pg = pg[pg.game_id.isin(wk_ids)]
        if OPP_ADJUST: week_pg = opponent_adjust(week_pg, teams_of, tend)
        ratings.update(week_pg)
        for r in stats[stats.game_id.isin(wk_ids)].itertuples(index=False):
            tend.add(r.team, [getattr(r, c) for c in ALL_TEAM_STATS])
        for (gid, team), strength in fielded.items():
            typical.add(team, [strength[k] for k in P.GROUPS])
        for n in ngs_by.get((season, week), pd.DataFrame()).itertuples(index=False):
            qbd.add(n.player_gsis_id, [n.completion_percentage_above_expectation, n.avg_time_to_throw, n.aggressiveness])
        for g in wk.itertuples(index=False): sit.update(g)
    return pd.DataFrame(rows), ratings, replacement


def opponent_adjust(week_pg, teams_of, tend):
    """Credit offensive EPA relative to the defense faced: subtract the opponent's
    pre-game EPA allowed per play (vs league average) from every snap."""
    def_epa = {t: tend.get(t)["def_epa"] for t in tend.sum}
    league = np.nanmean(list(def_epa.values())) if def_epa else np.nan
    if np.isnan(league): return week_pg
    pgc = week_pg.copy()
    opp = [(teams_of[gid][1] if team == teams_of[gid][0] else teams_of[gid][0]) if gid in teams_of else None for gid, team in zip(pgc.game_id, pgc.team)]
    adj = np.array([def_epa.get(o, league) for o in opp], dtype=float) - league
    adj = np.nan_to_num(adj)
    epa_groups = pgc.group.isin(["QB", "RB", "WR", "TE"]).to_numpy()
    # Per-snap EPA for skill players is mostly earned on their own touches; scale the
    # opponent adjustment by each group's share of the team's plays it is credited for.
    weight = pgc.group.map({"QB": 1.0, "RB": 0.25, "WR": 0.2, "TE": 0.15}).fillna(0).to_numpy()
    pgc.loc[epa_groups, "prod"] = pgc.loc[epa_groups, "prod"] - (adj * weight * pgc.exposure.to_numpy())[epa_groups]
    return pgc


def questionable_load(depth, q):
    """How much of tonight's lineup is listed Questionable (and how many of those missed practice)."""
    out = {"q_starters": 0.0, "q_qb": 0.0, "q_dnp": 0.0}
    for group, slots in depth.items():
        for pid, take, _ in slots:
            if pid in q and take >= .5:
                out["q_starters"] += 1
                if group == "QB": out["q_qb"] = 1.0
                if "Not Participate" in q[pid]: out["q_dnp"] += 1
    return out


def feature_row(g, sides, elo_pre, weather, srow):
    (hs, ht, htd, hx), (as_, at, atd, ax) = sides[g.home_team], sides[g.away_team]
    h_elo, a_elo, hfa = elo_pre
    neutral = g.location == "Neutral"
    outdoors = str(g.roof) in ("outdoors", "open")
    wind = float(g.wind) if outdoors and pd.notna(g.wind) else 0.0
    temp = float(g.temp) if outdoors and pd.notna(g.temp) else 65.0
    wx = weather.weather.get(g.game_id, "") if g.game_id in weather.index else ""
    r = {"game_id": g.game_id, "season": int(g.season), "week": int(g.week), "kickoff": g.kickoff.isoformat() if pd.notna(g.kickoff) else None,
         "home": g.home_team, "away": g.away_team, "home_espn": ESPN.get(g.home_team, g.home_team), "away_espn": ESPN.get(g.away_team, g.away_team),
         "home_score": g.home_score, "away_score": g.away_score,
         "spread_line": g.spread_line, "total_line": g.total_line, "home_moneyline": g.home_moneyline, "away_moneyline": g.away_moneyline,
         "home_elo": h_elo, "away_elo": a_elo, "elo_diff": h_elo - a_elo, "home_field": 0.0 if neutral else 1.0}
    for k in P.GROUPS:
        r[f"grp_{k}"] = hs[k] - as_[k]
        h_typ = ht[k] if pd.notna(ht[k]) else hs[k]
        a_typ = at[k] if pd.notna(at[k]) else as_[k]
        r[f"delta_{k}"] = (hs[k] - h_typ) - (as_[k] - a_typ)
        r[f"home_grp_{k}"], r[f"away_grp_{k}"] = hs[k], as_[k]
    n = lambda x: 0.0 if pd.isna(x) else float(x)
    r["net_epa_matchup"] = n((htd.off_epa - atd.def_epa) - (atd.off_epa - htd.def_epa))
    r["pass_matchup"] = n((htd.off_pass_epa - atd.def_pass_epa) - (atd.off_pass_epa - htd.def_pass_epa))
    r["rush_matchup"] = n((htd.off_rush_epa - atd.def_rush_epa) - (atd.off_rush_epa - htd.def_rush_epa))
    r["pressure_matchup"] = n((htd.def_sack_rate + atd.off_sack_rate) - (atd.def_sack_rate + htd.off_sack_rate))
    r["success_diff"] = n(htd.off_success - atd.off_success)
    r["rest_diff"] = n(g.home_rest - g.away_rest)
    r["short_week_diff"] = float(g.home_rest <= 5) - float(g.away_rest <= 5) if pd.notna(g.home_rest) and pd.notna(g.away_rest) else 0.0
    r["div_game"] = float(g.div_game) if pd.notna(g.div_game) else 0.0
    windy = max(0.0, wind - 10.0)
    r["wind"], r["temp"], r["precip"] = wind, temp, float(outdoors and precipitation(wx))
    r["wind_x_pass"] = windy * n(htd.pass_oe - atd.pass_oe)
    r["cold"] = float(temp < 40)
    r["total_pace"] = n(htd.plays + atd.plays)
    r["total_epa"] = n(htd.off_epa + atd.off_epa + htd.def_epa + atd.def_epa)
    # --- candidate factors for the lab ---
    r["precip_x_pass"] = r["precip"] * n(htd.pass_oe - atd.pass_oe)
    r["early_pass_diff"] = n(htd.early_pass - atd.early_pass)
    exp_epa = lambda o, d: n(o.off_epa_vs_man) * n(d.def_man_rate) + n(o.off_epa_vs_zone) * (1 - n(d.def_man_rate)) if pd.notna(d.def_man_rate) else 0.0
    r["coverage_matchup"] = exp_epa(htd, atd) - exp_epa(atd, htd)
    r["scheme_pressure_matchup"] = n((htd.def_pressure_rate + atd.off_pressure_allowed) - (atd.def_pressure_rate + htd.off_pressure_allowed))
    r["blitz_x_ttt"] = n(hx["ttt"] * atd.def_blitz_rate - ax["ttt"] * htd.def_blitz_rate)
    r["pa_rate_diff"] = n(htd.off_pa_rate - atd.off_pa_rate)
    r["motion_rate_diff"] = n(htd.off_motion_rate - atd.off_motion_rate)
    r["qb_cpoe_diff"] = n(hx["cpoe"] - ax["cpoe"])
    r["qb_ttt_diff"] = n(hx["ttt"] - ax["ttt"])
    r["qb_aggr_diff"] = n(hx["aggr"] - ax["aggr"])
    r["separation_diff"] = n(htd.separation - atd.separation)
    r["yac_oe_diff"] = n(htd.yac_oe - atd.yac_oe)
    for k in ["q_starters", "q_qb", "q_dnp"]: r[f"{k}_diff"] = hx[k] - ax[k]
    r.update(srow)
    return r


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--first", type=int, default=2013); ap.add_argument("--out-start", type=int, default=2016)
    ap.add_argument("--output", default=str(OUT)); a = ap.parse_args()
    df, _, rep = build(a.first, a.out_start)
    pathlib.Path(a.output).write_text(df.to_csv(index=False))
    print(f"wrote {len(df)} rows to {a.output}; replacement levels {rep}")


if __name__ == "__main__":
    main()
