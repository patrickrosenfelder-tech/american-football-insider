"""Results Elo: the part of a team's base rating that moves with every final score.

Chess-style update with the two NFL adjustments FiveThirtyEight popularized: a
margin-of-victory multiplier (with the autocorrelation correction so favorites
don't inflate) and regression toward the mean between seasons. Parameters are
tuned on seasons before the backtest window (see tune()).
"""
import itertools
import numpy as np

BASE = 1505.0
ELO_PER_POINT = 25.0  # 1 point of spread ~ 25 Elo points (538 convention); used to express adjustments in Elo
DEFAULT = {"k": 20.0, "home": 48.0, "revert": 1 / 3, "mov": 1.0}


def expected(diff):
    return 1 / (1 + 10 ** (-diff / 400))


def run(games, params=DEFAULT, record=None):
    """Replay games in kickoff order. Returns pre-game ratings per game_id and final ratings.

    games needs game_id, season, home_team, away_team, home_score, away_score, location.
    Unplayed games (NaN score) get pre-game ratings but no update.
    """
    k, home_adv, revert, mov_w = params["k"], params["home"], params["revert"], params["mov"]
    ratings, season, pre = {}, None, {}
    for g in games.itertuples(index=False):
        if season is not None and g.season != season:
            for t in ratings: ratings[t] = BASE + (ratings[t] - BASE) * (1 - revert)
        season = g.season
        h, a = ratings.get(g.home_team, BASE), ratings.get(g.away_team, BASE)
        hfa = 0.0 if getattr(g, "location", "Home") == "Neutral" else home_adv
        pre[g.game_id] = (h, a, hfa)
        if np.isnan(g.home_score) or np.isnan(g.away_score): continue
        margin = g.home_score - g.away_score
        diff = h + hfa - a
        e = expected(diff)
        actual = 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5
        winner_diff = diff if margin > 0 else -diff
        mult = (np.log(abs(margin) + 1) * 2.2 / (winner_diff * 0.001 + 2.2)) ** mov_w if margin else 1.0
        delta = k * mult * (actual - e)
        ratings[g.home_team] = h + delta
        ratings[g.away_team] = a - delta
    return pre, ratings


def log_loss(games, pre):
    played = games.dropna(subset=["home_score", "away_score"])
    played = played[played.home_score != played.away_score]
    p = np.array([expected(pre[g][0] + pre[g][2] - pre[g][1]) for g in played.game_id])
    y = (played.home_score > played.away_score).to_numpy(float)
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())


def tune(games, eval_seasons):
    """Grid search on eval_seasons only (all earlier seasons still feed the ratings)."""
    best = None
    for k, home, revert, mov in itertools.product([16, 20, 24, 28], [30, 40, 48, 56, 65], [.25, 1 / 3, .4, .5], [.75, 1.0]):
        params = {"k": k, "home": home, "revert": revert, "mov": mov}
        pre, _ = run(games, params)
        score = log_loss(games[games.season.isin(eval_seasons)], pre)
        if best is None or score < best[0]: best = (score, params)
    return best
