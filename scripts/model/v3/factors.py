"""Candidate factors for the factor lab. Everything here is point-in-time: values for a
game only use data from earlier weeks (decayed), or facts known before kickoff
(schedule, venue, coach, referee assignment, injury report).
"""
import math
import numpy as np
import pandas as pd
from . import data

# Home stadium (lat, lon, UTC offset during the season). Relocations are season-aware below.
TEAM_SITE = {
    "ARI": (33.53, -112.26, -7), "ATL": (33.76, -84.40, -4), "BAL": (39.28, -76.62, -4), "BUF": (42.77, -78.79, -4),
    "CAR": (35.23, -80.85, -4), "CHI": (41.86, -87.62, -5), "CIN": (39.10, -84.52, -4), "CLE": (41.51, -81.70, -4),
    "DAL": (32.75, -97.09, -5), "DEN": (39.74, -105.02, -6), "DET": (42.34, -83.05, -4), "GB": (44.50, -88.06, -5),
    "HOU": (29.68, -95.41, -5), "IND": (39.76, -86.16, -4), "JAX": (30.32, -81.64, -4), "KC": (39.05, -94.48, -5),
    "LV": (36.09, -115.18, -7), "LAC": (33.95, -118.34, -7), "LA": (33.95, -118.34, -7), "MIA": (25.96, -80.24, -4),
    "MIN": (44.97, -93.26, -5), "NE": (42.09, -71.26, -4), "NO": (29.95, -90.08, -5), "NYG": (40.81, -74.07, -4),
    "NYJ": (40.81, -74.07, -4), "PHI": (39.90, -75.17, -4), "PIT": (40.45, -80.02, -4), "SF": (37.40, -121.97, -7),
    "SEA": (47.60, -122.33, -7), "TB": (27.98, -82.50, -4), "TEN": (36.17, -86.77, -5), "WAS": (38.91, -76.86, -4),
}
RELOCATED = {("LV", 2019): (37.75, -122.20, -7), ("LAC", 2016): (32.78, -117.12, -7)}  # Oakland, San Diego
DOME_TEAMS = {"ARI", "ATL", "DAL", "DET", "HOU", "IND", "LV", "LAC", "LA", "MIN", "NO"}


def site(team, season):
    if team == "LV" and season <= 2019: return RELOCATED[("LV", 2019)]
    if team == "LAC" and season <= 2016: return RELOCATED[("LAC", 2016)]
    return TEAM_SITE.get(team, (39.0, -95.0, -5))


def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3959 * 2 * math.asin(math.sqrt(h))


def is_grass(surface):
    return str(surface).strip().lower() in ("grass", "dessograss")


class Situational:
    """Schedule/venue/coach/referee factors, updated game by game in kickoff order."""

    def __init__(self):
        self.home_surface, self.coach_last, self.coach_week1, self.ref = {}, {}, {}, {}
        self.season = None

    def new_season(self, season):
        if self.season is not None:
            self.coach_prev_season = dict(self.coach_last)
        else:
            self.coach_prev_season = {}
        self.coach_week1, self.season = {}, season

    def row(self, g):
        h, a, s = g.home_team, g.away_team, int(g.season)
        neutral = g.location == "Neutral"
        hs, as_ = site(h, s), site(a, s)
        r = {}
        r["travel_diff"] = 0.0 if neutral else miles(as_, hs) / 1000.0  # away team's trip, in 1000 miles
        r["tz_diff"] = 0.0 if neutral else float(abs(hs[2] - as_[2]))
        early = str(g.gametime) < "14:00"
        r["west_early"] = float(not neutral and early and as_[2] <= -6 and hs[2] >= -5)
        r["east_late"] = float(not neutral and str(g.gametime) >= "20:00" and as_[2] >= -5 and hs[2] <= -7)
        r["altitude"] = float(h == "DEN" and not neutral)
        r["primetime_home"] = float(str(g.gametime) >= "19:00" and not neutral)
        away_home_grass = self.home_surface.get(a)
        r["surface_change"] = float(away_home_grass is not None and pd.notna(g.surface) and away_home_grass != is_grass(g.surface))
        r["dome_team_cold"] = float((a in DOME_TEAMS) and str(g.roof) in ("outdoors", "open") and pd.notna(g.temp) and g.temp < 40)
        new = lambda t, c: float(t in self.coach_prev_season and isinstance(c, str) and self.coach_prev_season[t] != c)
        interim = lambda t, c: float(t in self.coach_week1 and isinstance(c, str) and self.coach_week1[t] != c)
        r["new_coach_diff"] = new(h, g.home_coach) - new(a, g.away_coach)
        r["new_coach_early"] = r["new_coach_diff"] * float(g.week <= 4)
        r["interim_coach_diff"] = interim(h, g.home_coach) - interim(a, g.away_coach)
        n, total = self.ref.get(g.referee, (0.0, 0.0))
        r["ref_home_bias"] = total / (n + 40.0)  # shrunk: a crew needs many games to move off zero
        return r

    def update(self, g):
        if g.location != "Neutral" and pd.notna(g.surface): self.home_surface[g.home_team] = is_grass(g.surface)
        for t, c in [(g.home_team, g.home_coach), (g.away_team, g.away_coach)]:
            if isinstance(c, str):
                self.coach_week1.setdefault(t, c); self.coach_last[t] = c
        if isinstance(g.referee, str) and not np.isnan(g.home_score) and g.location != "Neutral":
            n, total = self.ref.get(g.referee, (0.0, 0.0))
            self.ref[g.referee] = (n + 1, total + (g.home_score - g.away_score) - 1.8)


def scheme_stats(pbp, first, last):
    """Per (game, team) coverage / pressure / play-action tendencies from participation + FTN."""
    keys = pbp[["game_id", "play_id", "posteam", "defteam", "epa", "qb_dropback"]]
    frames = []
    for year in range(max(first, 2016), last + 1):
        path = data.CACHE / f"pbp_participation_{year}.parquet"
        try:
            if not path.exists():
                import urllib.request; urllib.request.urlretrieve(f"{data.RELEASES}/pbp_participation/{path.name}", path)
            frames.append(pd.read_parquet(path, columns=["nflverse_game_id", "play_id", "defense_man_zone_type", "number_of_pass_rushers", "was_pressure"]))
        except Exception as error:
            print(f"skipping participation {year}: {error}", flush=True)
    part = pd.concat(frames, ignore_index=True).rename(columns={"nflverse_game_id": "game_id"}) if frames else pd.DataFrame(columns=["game_id", "play_id"])
    ftn = []
    for year in range(max(first, 2022), last + 1):
        path = data.CACHE / f"ftn_charting_{year}.parquet"
        try:
            if not path.exists():
                import urllib.request; urllib.request.urlretrieve(f"{data.RELEASES}/ftn_charting/{path.name}", path)
            ftn.append(pd.read_parquet(path, columns=["nflverse_game_id", "nflverse_play_id", "is_play_action", "is_motion", "n_blitzers"]))
        except Exception as error:
            print(f"skipping ftn {year}: {error}", flush=True)
    ftn = pd.concat(ftn, ignore_index=True).rename(columns={"nflverse_game_id": "game_id", "nflverse_play_id": "play_id"}) if ftn else pd.DataFrame(columns=["game_id", "play_id"])
    ftn["play_id"] = pd.to_numeric(ftn.play_id, errors="coerce")
    p = keys.merge(part, on=["game_id", "play_id"], how="left").merge(ftn, on=["game_id", "play_id"], how="left")
    d = p[p.qb_dropback.eq(1) & p.epa.notna()].copy()
    cov = d.defense_man_zone_type.replace("", np.nan)
    d["man"] = cov.map({"MAN_COVERAGE": 1.0, "ZONE_COVERAGE": 0.0})
    d["pressure"] = pd.to_numeric(d.was_pressure, errors="coerce").astype(float)
    rushers = pd.to_numeric(d.number_of_pass_rushers, errors="coerce").where(lambda x: x > 0)
    d["blitz"] = (rushers >= 5).astype(float).where(rushers.notna())
    d["blitz"] = d.blitz.fillna((pd.to_numeric(d.n_blitzers, errors="coerce") > 0).astype(float).where(d.n_blitzers.notna()))
    d["pa"] = d.is_play_action.astype(float) if "is_play_action" in d else np.nan
    d["motion"] = d.is_motion.astype(float) if "is_motion" in d else np.nan
    d["epa_man"] = d.epa.where(d.man.eq(1)); d["epa_zone"] = d.epa.where(d.man.eq(0))
    off = d.groupby(["game_id", "posteam"]).agg(off_epa_vs_man=("epa_man", "mean"), off_epa_vs_zone=("epa_zone", "mean"),
                                                off_pressure_allowed=("pressure", "mean"), off_pa_rate=("pa", "mean"), off_motion_rate=("motion", "mean"))
    dfn = d.groupby(["game_id", "defteam"]).agg(def_man_rate=("man", "mean"), def_blitz_rate=("blitz", "mean"), def_pressure_rate=("pressure", "mean"))
    off.index.names = dfn.index.names = ["game_id", "team"]
    return off.join(dfn, how="outer").reset_index()


SCHEME = ["off_epa_vs_man", "off_epa_vs_zone", "off_pressure_allowed", "off_pa_rate", "off_motion_rate", "def_man_rate", "def_blitz_rate", "def_pressure_rate"]


def ngs_qb():
    """Weekly NGS passing per QB (gsis id): CPOE, time to throw, aggressiveness."""
    path = data.CACHE / "ngs_passing.parquet"
    if not path.exists():
        import urllib.request; urllib.request.urlretrieve(f"{data.RELEASES}/nextgen_stats/ngs_passing.parquet", path)
    n = pd.read_parquet(path)
    n = n[n.season_type.eq("REG") & (n.week > 0)]
    return n[["season", "week", "player_gsis_id", "attempts", "completion_percentage_above_expectation", "avg_time_to_throw", "aggressiveness"]]


def ngs_team_receiving():
    path = data.CACHE / "ngs_receiving.parquet"
    if not path.exists():
        import urllib.request; urllib.request.urlretrieve(f"{data.RELEASES}/nextgen_stats/ngs_receiving.parquet", path)
    n = pd.read_parquet(path)
    n = n[n.season_type.eq("REG") & (n.week > 0)].copy()
    n["w_sep"] = n.avg_separation * n.targets; n["w_yac"] = n.avg_yac_above_expectation * n.receptions
    g = n.groupby(["season", "week", "team_abbr"]).agg(t=("targets", "sum"), r=("receptions", "sum"), s=("w_sep", "sum"), y=("w_yac", "sum")).reset_index()
    g["separation"] = g.s / g.t.where(g.t > 0); g["yac_oe"] = g.y / g.r.where(g.r > 0)
    return g.rename(columns={"team_abbr": "team"})[["season", "week", "team", "separation", "yac_oe"]]
