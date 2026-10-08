# American Football Insider

NFL insider site: live scores, Madden-style depth charts, injuries, matchup previews, scheme tendencies, a playoff predictor, in-site news, weather, betting trends and model picks. An Express API that wraps free public data sources, with a React (Vite) UI served by the same server.

**Live:** https://american-football-insider.fly.dev

## Features

- **Scores / Standings / Teams / Game detail**: live scoreboard (30s refresh during games), standings with seeds, team pages, box scores.
- **Depth charts** (`/teams/KC?tab=depth`): Madden-style formation layout, with Offense, Defense (4-3 or 3-4) and Special Teams tabs. Each card shows position, headshot, name and injury badge. You can expand to see depth 2 and 3. There are **no ratings**, only the visual layout.
- **Rosters and player pages**: full roster grouped by position. Player pages show bio, season stats and injury or practice status.
- **Injuries** (`/injuries`, team tab): status, injury, return estimate, practice participation and date updated.
- **Matchup previews** (`/previews`, `/preview/:gameId`): records, starting QBs, key injuries, recent form, team stat comparison, head-to-head, lines, **betting trends**, **AFI pick**, **weather** and **scheme tendencies**.
- **Scheme tendencies** (`/tendencies`, team tab): season and last-3-game splits for pass/run, neutral pass rate, shotgun, pace, motion, play action, RPO, blitz rate, pass rushers and box count. Personnel groupings, man/zone and coverage shells come from the latest season nflverse has published.
- **Playoff predictor** (`/playoffs`): pick every remaining game (tap a team, use "Pick all favorites", or reset). The page then shows seeds 1-7, division winners, the wild-card bracket and division tables with tiebreakers applied. Picks are encoded in the URL (`?p=`), so the link can be shared. The **Playoff odds** tab runs 10,000 Monte Carlo sims and shows make playoffs %, win division % and #1 seed %.
- **News** (`/news`, `/news/:id`, team tab): stories that are readable on the site. Each story has a short summary in our own words and links to all of its sources (details below).
- **Weather** (`/weather`): kickoff-hour temperature, wind and direction, precipitation and conditions for every game. Shows whether the venue is a dome, covered or has a retractable roof, plus an impact flag.
- **AFI Picks** (`/picks`): our model's spread, total and moneyline pick per game, with 2-3 sentences of reasoning and a transparent season W-L. It is for entertainment only and is not betting advice.

## Run locally

Requires Node 20+.

```bash
npm install
npm run build          # builds the React app into client/dist
PORT=3002 npm start    # http://localhost:3002  (3000/3001 are taken on the dev Mac)
```

Optional env (see `.env`, never committed): `GROQ_API_KEY`, `OPENROUTER_API_KEY` for news summaries, `NEWS_DAILY_LLM_CAP` (default `40`), `NEWS_RUN_LLM_CAP` (default `10`), `NEWS_DAILY_LLM_REQUEST_CAP` (default `30`), `ADMIN_TOKEN` for manual job triggers, `DB_PATH` for SQLite.

## API

All responses are JSON: `{ success, data, timestamp }`. Team ids accept abbreviations (`KC`) or ESPN ids.

| Endpoint | Description |
| --- | --- |
| `GET /api/games[?week=&season=&seasontype=]`, `GET /api/games/:id` | Scoreboard, game detail |
| `GET /api/standings`, `GET /api/teams`, `GET /api/teams/:team` | Standings, teams, team + schedule |
| `GET /api/teams/:team/depthchart` | Depth chart (offense / defense / special teams slots, injury-decorated) |
| `GET /api/teams/:team/roster`, `GET /api/players/:athleteId` | Roster by position, player page |
| `GET /api/injuries`, `GET /api/teams/:team/injuries` | League-wide / team injury report |
| `GET /api/previews[?week=]`, `GET /api/previews/:gameId` | Matchup previews |
| `GET /api/tendencies`, `GET /api/teams/:team/tendencies` | League tendencies table, team tendencies |
| `GET /api/playoffs` | Teams, full schedule with results + win probabilities, current seeds |
| `GET /api/playoffs/odds` | Monte Carlo playoff odds (10k sims) |
| `POST /api/playoffs/scenario` `{ "picks": { "<gameId>": "H"\|"A"\|"T" } }` | Standings / seeds / bracket for picks |
| `GET /api/news[?team=PHI&kind=headline\|data]`, `GET /api/news/:id` | News feed, story |
| `GET /api/news/status`, `GET /api/status` | News run state; the latter includes `N/40 today`, last provider and health |
| `GET /api/weather[?week=]`, `GET /api/weather/game/:gameId` | Kickoff forecasts + impact |
| `GET /api/trends/team/:team`, `GET /api/trends/game/:gameId` | ATS / O-U / SU splits, key trends |
| `GET /api/picks[?week=]` | AFI Picks + season record |
| `GET /api/admin/jobs` | Job schedule + last run |
| `POST /api/admin/jobs/:job/run[?wait=1]` (Bearer `ADMIN_TOKEN`) | Run a job now (`news`, `picks`, `pbp_derived`, `schedules`, `player_stats`, `practice_report`) |
| `GET /admin/llm` (Bearer `ADMIN_TOKEN`) | Today and seven-day provider usage, errors/429s and latest observed limits |

```bash
curl -s https://american-football-insider.fly.dev/api/teams/KC/depthchart | jq '.data.offense.slots[0]'
curl -s https://american-football-insider.fly.dev/api/playoffs/odds | jq '.data.teams[:3]'
curl -s -X POST https://american-football-insider.fly.dev/api/playoffs/scenario -H 'Content-Type: application/json' -d '{"picks":{}}' | jq '.data.conferences.AFC.seeds[0]'
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://american-football-insider.fly.dev/api/admin/jobs/news/run?wait=1"
```

## Data sources

- **ESPN public JSON** (keyless, unofficial): scoreboard, summary, teams, rosters, depth charts, standings, injuries, news, transactions, odds (DraftKings lines via ESPN).
- **nflverse** (GitHub releases, free): play-by-play, FTN charting, participation, player stats, snap counts, official injury/practice reports, and `nfldata/games.csv` (results + closing spread/total lines since 1999).
- **Open-Meteo** (free, no key, non-commercial terms): weather forecast + geocoding.
- **News feeds**: ESPN NFL news API and the RSS feeds of ESPN, CBS Sports, Yahoo Sports and ProFootballTalk. We use headlines and snippets only.

### News: legal approach and LLM summaries

We do **not** republish articles. Headlines from the feeds are tagged with teams and players (ESPN categories plus name matching against all 32 rosters), and duplicate headlines are grouped into one story. Each story gets a 3-6 sentence factual summary in our own words, written by an LLM from **only** the headlines and snippets, plus a "Sources" list that links to every outlet. Each story shows "Summary generated by AI from linked sources". Data stories (game recaps from box scores, injury-report changes, roster moves) are written from structured data.

LLM fallback chain (free tiers, one key per provider, keys only from Fly secrets, never logged):
1. Groq (`GROQ_API_KEY`), using Qwen, gpt-oss or Llama, whichever the account currently offers
2. OpenRouter `:free` models (`OPENROUTER_API_KEY`)
3. If both fail, the run skips summaries and keeps the data stories. Unsummarized headlines are listed as link-outs marked “summary pending”, and the next run retries them.

Model IDs are discovered from each provider's model list (cached 6 h), because free-tier model names change often. You can override them with `GROQ_MODELS` or `OPENROUTER_MODELS` (comma-separated). If a model returns 404, 400 or 503, the next model is tried. A 429 puts that provider on a 65 s cooldown. Timeouts, 5xx and auth errors move to the next provider. Rate limits: 5 stories per request, at least 4-15 s between calls per provider, at most 10 stories per run and 40 per day by default (`NEWS_RUN_LLM_CAP`, `NEWS_DAILY_LLM_CAP`), and at most 30 LLM requests per US Eastern day including failed and retried calls (`NEWS_DAILY_LLM_REQUEST_CAP`). Overlapping news runs share one in-flight run. The app records observed Groq rate-limit headers and OpenRouter key usage/limit data (checked 2026-10-07); free-tier allowances change, so the provider consoles remain authoritative.

### Models and formulas

- **Playoff win probability**: de-vigged moneyline when posted. Otherwise the spread (normal distribution, sd 13.5). Otherwise a power-rating spread: margin per game shrunk by 4 phantom games, +1.5 home field.
- **Tiebreakers** (`src/services/playoffEngine.js`):
  - Division: head-to-head, division record, common games, conference record, strength of victory, strength of schedule, net points, coin toss.
  - Wild card: same-division clubs are first reduced to the division leader. Then head-to-head (a sweep is required for 3+ clubs), conference record, common games (minimum 4), SOV, SOS, net points, coin toss.
  - Simplified: the points-ranking steps, net points in common/conference games and net TDs are skipped. The coin toss is deterministic (team id). Picked games carry no score, so net-points steps use real games only.
- **AFI Picks**:
  - Margin: the season point-margin rating, using half of last season's margin as a 4-game prior, plus 1.5 for home field. A starting QB out costs -4. Each other injured starter costs -0.5 (max -2).
  - Total: blended team points scored and allowed per game, minus 3 for wind, rain or snow.
  - Picks re-run hourly until kickoff, then lock. They are graded against the line at pick time. Tracking started 2026-10-06 (Week 5).
- **Trends**: computed from nflverse closing lines. `spread_line` > 0 means the home team was favored.
- **Weather impact flags**: wind over 15 mph (or gusts over 30), heavy rain or snow, ≤25°F, or ≥90°F. Domes and covered stadiums show no impact. Retractable roofs are assumed to close in bad weather.

## Refresh schedule (in-app scheduler, US Eastern)

| Job | When |
| --- | --- |
| ESPN rosters / depth charts / injuries | cache TTL 6 h / 6 h / 1 h |
| `practice_report`, `player_stats` (nflverse) | daily 07:00 |
| `schedules` (results + lines for trends, H2H) | daily 06:00 |
| `pbp_derived` (team stats + tendencies) | Tuesday 08:00 (after MNF) |
| `news` | every 3 h |
| `picks` | hourly |

Every job also runs at boot if its data is missing. Every page shows "last updated".

## Deploy (Fly.io)

App `american-football-insider`: one shared-cpu-1x 256 MB machine in `iad`, kept running (`min_machines_running = 1`) so the scheduler fires. SQLite lives on the `afi_data` volume at `/data`, which keeps news summaries, injury snapshots and the AFI Picks record across deploys.

```bash
fly deploy --remote-only -a american-football-insider
fly secrets set GROQ_API_KEY=... OPENROUTER_API_KEY=... ADMIN_TOKEN=... -a american-football-insider
```

## Open items

- **X/Twitter**: the official API is paid and scraping is not allowed, so it is skipped. **Bluesky / Reddit**: not wired in yet. Reddit's Data API needs registered OAuth apps. Bluesky's public API is usable if we pick a list of accounts.
- **Depth-chart change stories**: not yet built. They need daily depth-chart snapshots (injury changes already work this way).
- nflverse **participation** data (personnel groupings, man/zone, coverage shells) is only published after a season ends, so it shows 2025 until then. FTN charting and play-by-play lag about 1 day after games.
- Playoff bracket: wild-card round and byes are shown. Later rounds re-seed, and picking playoff games isn't supported yet.
- AFI Picks has no backfilled record before Week 5 2026 (no fake history). No injury data exists for historical backtests.
- The ESPN endpoints are unofficial and could change shape without notice. There are no automated tests yet.
