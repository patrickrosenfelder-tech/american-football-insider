"""Point-in-time AFI player grades and roster-based position-group strength.

Every player gets a production rate per snap on the field (EPA for QB/RB/WR/TE,
a pressure/ball-production score for defenders, team pass protection for OL,
points over expected for kickers). Rates are decay-weighted and shrunk toward
the position's replacement level (what backups actually produce), so a player
with a few good snaps stays near replacement. Ratings are frozen before each
week's games and only use earlier weeks: nothing here looks ahead.

Group strength for one team in one game = sum over its *available* players of
(rating - replacement) x expected snap share x snaps per game. A missing
starter's share is refilled by the next available players at their own grade,
so a QB injury costs exactly the starter-to-backup gap.
"""
import numpy as np
import pandas as pd
from . import data

OFFENSE = ["QB", "RB", "WR", "TE", "OL"]
DEFENSE = ["DL", "LB", "CB", "S"]
GROUPS = OFFENSE + DEFENSE + ["K"]
POSITION_GROUP = {
    "QB": "QB", "RB": "RB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE",
    "T": "OL", "G": "OL", "C": "OL", "OT": "OL", "OG": "OL", "OL": "OL", "LT": "OL", "RT": "OL", "LG": "OL", "RG": "OL",
    "DE": "DL", "DT": "DL", "NT": "DL", "DL": "DL", "EDGE": "DL",
    "OLB": "LB", "ILB": "LB", "MLB": "LB", "LB": "LB", "WILL": "LB", "MIKE": "LB", "SAM": "LB",
    "CB": "CB", "NB": "CB", "FS": "S", "SS": "S", "S": "S", "SAF": "S", "DB": "S", "K": "K", "PK": "K",
}
# Defender event weights: a sack is the unit; ball production counts more than hits.
DEF_EVENTS = {"sack_player_id": 1.0, "half_sack_1_player_id": .5, "half_sack_2_player_id": .5, "qb_hit_1_player_id": .35,
              "qb_hit_2_player_id": .35, "tackle_for_loss_1_player_id": .4, "interception_player_id": 1.2,
              "pass_defense_1_player_id": .5, "pass_defense_2_player_id": .5, "forced_fumble_player_1_player_id": .8}
SNAPS_PER_GAME = 63.0
KICKS_PER_GAME = 1.9
# Shrinkage strength in snaps (attempts for K): how much evidence it takes to move off replacement.
# Half-life and shrinkage were tuned by walk-forward log loss (2017-2026): 8/12/20/30-week
# half-lives and 0.5x/1x/2x/3x shrinkage; 20 weeks at these values sits on the plateau.
SHRINK = {"QB": 500, "RB": 600, "WR": 800, "TE": 800, "OL": 1200, "DL": 1000, "LB": 1000, "CB": 1200, "S": 1200, "K": 50}
HALF_LIFE_WEEKS = 20.0
OFFSEASON_WEEKS = 10.0


def fg_make_probability(distance):
    # League field-goal curve (2012-2015 fit); used only as the expectation for kicker credit.
    return 1 / (1 + np.exp(-(6.1 - 0.115 * distance)))


def player_game_production(pbp):
    """One row per (game, player) with production and the exposure it was earned on."""
    p = pbp[pbp.play_type.notna() & pbp.qb_kneel.ne(1) & pbp.qb_spike.ne(1) & pbp.two_point_attempt.ne(1)]
    rows = []
    drop = p[p.qb_dropback.eq(1)]
    qb_id = drop.passer_player_id.fillna(drop.rusher_player_id)
    rows.append(pd.DataFrame({"game_id": drop.game_id, "gsis_id": qb_id, "prod": drop.qb_epa.fillna(0), "role": "QB"}))
    designed = p[p.rush.eq(1) & p.qb_scramble.ne(1)]
    rows.append(pd.DataFrame({"game_id": designed.game_id, "gsis_id": designed.rusher_player_id, "prod": designed.epa.fillna(0), "role": "skill"}))
    targets = p[p["pass"].eq(1) & p.receiver_player_id.notna()]
    rows.append(pd.DataFrame({"game_id": targets.game_id, "gsis_id": targets.receiver_player_id, "prod": targets.epa.fillna(0), "role": "skill"}))
    for column, weight in DEF_EVENTS.items():
        e = p[p[column].notna()]
        rows.append(pd.DataFrame({"game_id": e.game_id, "gsis_id": e[column], "prod": weight, "role": "def"}))
    fg = p[p.field_goal_attempt.eq(1) & p.kicker_player_id.notna() & p.kick_distance.notna()]
    made = fg.field_goal_result.eq("made").astype(float)
    rows.append(pd.DataFrame({"game_id": fg.game_id, "gsis_id": fg.kicker_player_id, "prod": 3 * (made - fg_make_probability(fg.kick_distance)), "role": "K", "kicks": 1.0}))
    out = pd.concat(rows, ignore_index=True).dropna(subset=["gsis_id"])
    out["kicks"] = out["kicks"].fillna(0)
    # Designed QB runs count toward the QB's own rating, not a separate skill rating.
    return out.groupby(["game_id", "gsis_id"], as_index=False).agg(prod=("prod", "sum"), kicks=("kicks", "sum"))


# PFR advanced stats (2018+) add what play-by-play does not credit to one player: coverage
# allowed, hurries and missed tackles for defenders, contact yards for RBs. Terms are in each
# group's own production units (defenders: a sack = 1; RBs: EPA) and scaled by PFR_SCALE,
# which the factor lab tests at 0 / 0.5 / 1 / 2.
PFR_SCALE = 1.0
PFR_FIRST = 2018
# Lab (2019-2026): defenders 0.62546 -> 0.62392 log loss; RB contact yards added nothing (0.62549).
PFR_GROUPS = list(DEFENSE)


def pfr_production(first, last):
    path = lambda kind, y: data.CACHE / f"advstats_week_{kind}_{y}.parquet"
    def load(kind):
        frames = []
        for y in range(max(first, PFR_FIRST), last + 1):
            p = path(kind, y)
            try:
                if not p.exists():
                    import urllib.request; urllib.request.urlretrieve(f"{data.RELEASES}/pfr_advstats/{p.name}", p)
                frames.append(pd.read_parquet(p))
            except Exception as error:
                print(f"skipping pfr {kind} {y}: {error}", flush=True)
        d = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        return d[d.game_type.eq("REG")] if len(d) else d
    d, r = load("def"), load("rush")
    n = lambda s: pd.to_numeric(s, errors="coerce").fillna(0)
    cover = -(n(d.def_yards_allowed) - 6.5 * n(d.def_targets)) / 25 - 0.5 * n(d.def_receiving_td_allowed)
    rows = [pd.DataFrame({"game_id": d.game_id, "pfr_id": d.pfr_player_id,
                          "pfr_prod": cover + 0.25 * n(d.def_times_hurried) - 0.15 * n(d.def_missed_tackles)})]
    if len(r):
        rows.append(pd.DataFrame({"game_id": r.game_id, "pfr_id": r.pfr_player_id,
                                  "pfr_prod": 0.04 * (n(r.rushing_yards_after_contact) - 2.8 * n(r.carries)) + 0.15 * n(r.rushing_broken_tackles)}))
    return pd.concat(rows, ignore_index=True).groupby(["game_id", "pfr_id"], as_index=False).pfr_prod.sum()


def team_protection(pbp):
    """Per (game, offense) pass protection + run blocking score, shared by that game's OL."""
    p = pbp[pbp.posteam.notna() & pbp.qb_kneel.ne(1) & pbp.qb_spike.ne(1)]
    g = p.groupby(["game_id", "posteam"])
    drops = g.qb_dropback.sum().clip(lower=1)
    hits = (p.qb_hit_1_player_id.notna() & p.sack.ne(1)).groupby([p.game_id, p.posteam]).sum()
    sacks = g.sack.sum()
    rush = p[p.rush.eq(1) & p.qb_scramble.ne(1)].groupby(["game_id", "posteam"]).epa.mean()
    score = -(sacks + .35 * hits) / drops + rush.reindex(drops.index).fillna(0)
    return score.rename("ol_score").reset_index().rename(columns={"posteam": "team"})


def load_inputs(first, last, refresh_current=False):
    years = range(first, last + 1)
    pbp = data.load("pbp", years, data.PBP_COLUMNS, refresh_current)
    snaps = data.load("snaps", years, refresh_current=refresh_current)
    rosters = data.load("rosters", years, ["season", "week", "game_type", "team", "position", "depth_chart_position", "status",
                                           "gsis_id", "pfr_id", "full_name", "draft_number", "years_exp"], refresh_current)
    injuries = data.load("injuries", years, ["season", "week", "game_type", "team", "gsis_id", "report_status", "practice_status"], refresh_current)
    return pbp, snaps, rosters, injuries


def player_games(pbp, snaps, rosters):
    """Snap-count rows joined to GSIS ids, position group and production."""
    ids = data.players().dropna(subset=["pfr_id", "gsis_id"]).drop_duplicates("pfr_id")[["pfr_id", "gsis_id"]]
    s = snaps.merge(ids, left_on="pfr_player_id", right_on="pfr_id", how="inner")
    pos = rosters.dropna(subset=["gsis_id"]).copy()
    pos["group"] = pos.depth_chart_position.map(POSITION_GROUP).fillna(pos.position.map(POSITION_GROUP))
    pos = pos.dropna(subset=["group"]).sort_values(["season", "week"]).drop_duplicates(["season", "gsis_id"], keep="last")[["season", "gsis_id", "group"]]
    s = s.merge(pos, on=["season", "gsis_id"], how="left")
    s["group"] = s.group.fillna(s.position.map(POSITION_GROUP))
    s = s.dropna(subset=["group"])
    prod = player_game_production(pbp)
    s = s.merge(prod, on=["game_id", "gsis_id"], how="left").fillna({"prod": 0.0, "kicks": 0.0})
    ol = team_protection(pbp)
    s = s.merge(ol, on=["game_id", "team"], how="left")
    offense = s.group.isin(OFFENSE)
    s["share"] = np.where(offense, s.offense_pct, s.defense_pct).astype(float)
    s["exposure"] = np.where(offense, s.offense_snaps, s.defense_snaps).astype(float)
    is_ol = s.group.eq("OL")
    s.loc[is_ol, "prod"] = s.loc[is_ol, "ol_score"].fillna(0) * s.loc[is_ol, "exposure"]
    if PFR_SCALE:
        pfr = pfr_production(int(s.season.min()), int(s.season.max()))
        s = s.merge(pfr, on=["game_id", "pfr_id"], how="left")
        ok = s.group.isin(PFR_GROUPS)
        s.loc[ok, "prod"] = s.loc[ok, "prod"] + PFR_SCALE * s.loc[ok, "pfr_prod"].fillna(0)
    is_k = s.group.eq("K")
    s.loc[is_k, "exposure"] = s.loc[is_k, "kicks"]
    s.loc[is_k, "share"] = (s.loc[is_k, "kicks"] > 0).astype(float)
    return s[["season", "week", "game_id", "team", "gsis_id", "player", "group", "share", "exposure", "prod"]]


def replacement_levels(pg, seasons):
    """Per-snap production of part-time players (season share < 30%) in the calibration seasons."""
    x = pg[pg.season.isin(seasons)]
    agg = x.groupby(["season", "gsis_id", "group"]).agg(prod=("prod", "sum"), exposure=("exposure", "sum"), share=("share", "mean")).reset_index()
    out = {}
    for group, g in agg.groupby("group"):
        backups = g[(g.share < .3) & (g.exposure > 0)]
        out[group] = float(backups["prod"].sum() / backups.exposure.sum()) if len(backups) else 0.0
    return out


def availability(rosters, injuries):
    """(season, week, team, gsis_id) rows for players expected to be active before kickoff."""
    active = rosters[rosters.status.eq("ACT")].dropna(subset=["gsis_id"])
    out =injuries[injuries.report_status.isin(["Out", "Doubtful"])][["season", "week", "gsis_id"]].assign(out=1)
    a = active[["season", "week", "team", "gsis_id"]].drop_duplicates().merge(out, on=["season", "week", "gsis_id"], how="left")
    return a[a.out.isna()].drop(columns="out")


class Ratings:
    """Decayed sums per player; read before a week's games, update after."""

    def __init__(self, replacement):
        self.replacement = replacement
        self.state = pd.DataFrame(columns=["group", "s_prod", "s_exp", "s_share", "s_n", "games"]).astype(
            {"s_prod": float, "s_exp": float, "s_share": float, "s_n": float, "games": float})

    def decay(self, weeks):
        f = 0.5 ** (weeks / HALF_LIFE_WEEKS)
        self.state[["s_prod", "s_exp", "s_share", "s_n"]] *= f

    def snapshot(self):
        st = self.state
        prior = st.group.map(self.replacement).astype(float)
        k = st.group.map(SHRINK).astype(float)
        rate = (st.s_prod + k * prior) / (st.s_exp + k)
        share = (st.s_share / st.s_n.where(st.s_n > 0)).fillna(0)
        return pd.DataFrame({"group": st.group, "rate": rate, "above": rate - prior, "share": share, "games": st.games})

    def update(self, week_games):
        g = week_games.groupby("gsis_id").agg(group=("group", "last"), prod=("prod", "sum"), exp=("exposure", "sum"),
                                              share=("share", "sum"), n=("share", "size"))
        st = self.state.reindex(self.state.index.union(g.index))
        st["group"] = g.group.combine_first(st.group)
        for col, src in [("s_prod", "prod"), ("s_exp", "exp"), ("s_share", "share"), ("s_n", "n")]:
            st[col] = st[col].fillna(0) + g[src].reindex(st.index).fillna(0)
        st["games"] = st.games.fillna(0) + g.n.reindex(st.index).fillna(0)
        self.state = st


CAPACITY = {"QB": 1.0, "RB": 1.0, "WR": 2.6, "TE": 1.2, "OL": 5.0, "DL": 3.2, "LB": 2.2, "CB": 2.6, "S": 2.0, "K": 1.0}


def group_strength(snap, avail_ids):
    """Strength per group for one team: fill each group's capacity with available players by expected share."""
    roster = snap.reindex([i for i in avail_ids if i in snap.index]).dropna(subset=["group"])
    out, depth = {}, {}
    for group in GROUPS:
        g = roster[roster.group.eq(group)].sort_values(["share", "games"], ascending=False)
        cap, total, starters = CAPACITY[group], 0.0, []
        # First pass: each player plays his usual share. Second pass: leftover goes to
        # remaining players in depth order at full-time share (the backup steps in).
        used = {}
        for pid, row in g.iterrows():
            take = min(row.share, cap - sum(used.values()))
            if take > 0: used[pid] = take
        for pid, row in g.iterrows():
            left = cap - sum(used.values())
            if left <= 1e-9: break
            take = min(1.0 - used.get(pid, 0), left)
            if take > 0: used[pid] = used.get(pid, 0) + take
        for pid, take in used.items():
            total += take * g.at[pid, "above"]
            starters.append((pid, round(take, 3), g.at[pid, "rate"]))
        scale = KICKS_PER_GAME if group == "K" else SNAPS_PER_GAME
        out[group] = total * scale
        depth[group] = starters
    return out, depth
