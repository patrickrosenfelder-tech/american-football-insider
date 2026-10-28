"""Cached loaders for the free nflverse datasets that AFI v3 is built from."""
import pathlib, urllib.request
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
RELEASES = "https://github.com/nflverse/nflverse-data/releases/download"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
# nflverse release tag -> file pattern. Only regular-season rows are used downstream.
FILES = {
    "pbp": ("pbp", "play_by_play_{year}.parquet"),
    "snaps": ("snap_counts", "snap_counts_{year}.parquet"),
    "rosters": ("weekly_rosters", "roster_weekly_{year}.parquet"),
    "injuries": ("injuries", "injuries_{year}.parquet"),
}
PBP_COLUMNS = [
    "game_id", "play_id", "season", "week", "season_type", "home_team", "away_team", "posteam", "defteam",
    "play_type", "pass", "rush", "sack", "qb_dropback", "qb_scramble", "qb_kneel", "qb_spike", "two_point_attempt",
    "down", "epa", "qb_epa", "cpoe", "pass_oe", "shotgun", "passer_player_id", "rusher_player_id", "receiver_player_id",
    "sack_player_id", "half_sack_1_player_id", "half_sack_2_player_id", "qb_hit_1_player_id", "qb_hit_2_player_id",
    "tackle_for_loss_1_player_id", "interception_player_id", "pass_defense_1_player_id", "pass_defense_2_player_id",
    "forced_fumble_player_1_player_id", "field_goal_attempt", "field_goal_result", "kick_distance", "kicker_player_id",
    "wind", "temp", "roof", "weather", "total_home_score", "total_away_score", "start_time", "game_date",
]


def fetch(kind, year, refresh=False):
    """Download one season of a dataset into the shared model cache (reused by v2)."""
    tag, pattern = FILES[kind]
    path = CACHE / pattern.format(year=year)
    if refresh or not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f"downloading {path.name}", flush=True)
        urllib.request.urlretrieve(f"{RELEASES}/{tag}/{path.name}", path)
    return path


def load(kind, years, columns=None, refresh_current=False):
    frames = []
    for year in years:
        try:
            path = fetch(kind, year, refresh=refresh_current and year == max(years))
        except Exception as error:  # a season that nflverse has not published yet
            print(f"skipping {kind} {year}: {error}", flush=True)
            continue
        available = None
        if columns:
            import pyarrow.parquet as pq
            names = set(pq.read_schema(path).names)
            available = [c for c in columns if c in names]
        frames.append(pd.read_parquet(path, columns=available))
    out = pd.concat(frames, ignore_index=True)
    if "season_type" in out:
        out = out[out.season_type.eq("REG")]
    if "game_type" in out:
        out = out[out.game_type.eq("REG")]
    return out.reset_index(drop=True)


def players(refresh=False):
    """nflverse player master table: the only complete pfr_id <-> gsis_id map (weekly rosters miss most OL)."""
    path = CACHE / "players.parquet"
    if refresh or not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(f"{RELEASES}/players/players.parquet", path)
    return pd.read_parquet(path)


def games(refresh=False):
    path = CACHE / "games.csv"
    if refresh or not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(GAMES_URL, path)
    g = pd.read_csv(path)
    g = g[g.game_type.eq("REG")].copy()
    g["kickoff"] = pd.to_datetime(g.gameday.astype(str) + " " + g.gametime.fillna("13:00"), utc=True, errors="coerce")
    return g.sort_values(["kickoff", "game_id"]).reset_index(drop=True)
