# American Football Insider API

NFL insider/analytics backend: real-time multi-source score aggregation, team
and player data, and a caching + SQLite persistence layer, built for the
American Football Insider project.

Data sources (no API keys required):

- **ESPN** public NFL site API — teams, rosters, schedules, live scores, box
  scores, standings.
- **Sleeper** public NFL API — injury status/practice reports and fantasy
  add/drop trends. Merged into ESPN rosters by ESPN player id.

The service fetches, normalizes, joins, caches, and persists this data — it
isn't just a proxy.

## Features

- **REST API** for schedules/scoreboard, teams + rosters, game boxscores,
  player stats, and league standings.
- **In-memory caching** (`node-cache`) with per-resource TTLs, request
  de-duplication for concurrent cold-cache hits, swappable for Redis later
  without touching callers (`src/cache.js`).
- **SQLite persistence** (Node's built-in `node:sqlite`, no native build step)
  with a `teams` / `games` / `player_stats` schema, upserted on every fetch.
- **WebSocket live updates**: the server polls the scoreboard every 30s
  (configurable) and pushes a `scores:update` event only for games whose
  score or status actually changed.

## Requirements

- Node.js >= 22.13.0 (uses the built-in `node:sqlite` module — no native
  compilation, no extra services required to run locally)

## Run locally

```bash
npm install
npm start
# API listening on http://localhost:3000
```

Verify it:

```bash
npm test                 # offline unit tests (no network needed)
npm run smoke            # with the server running: hits every endpoint against live data
```

Copy `.env.example` to `.env` to override defaults (port, cache TTLs, poll
interval, DB path).

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/api/teams` | All 32 NFL teams with conference/division (cached, seeded from ESPN) |
| GET | `/api/teams/:id` | Team detail + record + roster, roster enriched with Sleeper injury status (ESPN team id) |
| GET | `/api/games/scoreboard?week=&season=&seasontype=` | Live/scheduled scores for a week (defaults to current week) |
| GET | `/api/games/db?week=&season=&seasontype=` | Same data served straight from the local SQLite cache |
| GET | `/api/games/:id` | Game detail: final/live score, team stats, full player boxscore (ESPN event id) |
| GET | `/api/stats/game/:id` | Player stats for a game from SQLite (fetched from ESPN on first request) |
| GET | `/api/standings` | Conference standings |
| GET | `/api/players/trending?type=add\|drop&limit=&hours=` | Most added/dropped players across Sleeper leagues |
| GET | `/api/players/injuries?team=` | Current injury report, optionally for one team (e.g. `KC`) |
| WS | (default namespace) | Emits `connected` on connect, `scores:update` when any game's score/status changes |

### Example

```bash
curl http://localhost:3000/api/games/scoreboard
curl http://localhost:3000/api/teams/22          # Arizona Cardinals
curl http://localhost:3000/api/games/401872948   # completed game with full boxscore
curl http://localhost:3000/api/players/injuries?team=KC
curl "http://localhost:3000/api/players/trending?type=add&limit=10"
```

Invalid ids return `400`; unknown team/game ids return `404`; upstream
failures return `502`.

`seasontype`: `1` preseason, `2` regular season, `3` postseason.

## WebSocket example

```js
const { io } = require('socket.io-client');
const socket = io('http://localhost:3000');
socket.on('scores:update', (payload) => console.log(payload));
```

## Database schema

SQLite file at `DB_PATH` (default `./data/football.db`):

- `teams(espn_id, name, display_name, abbreviation, location, conference, division, logo_url, updated_at)`
- `games(espn_id, season, week, season_type, start_date, home_team_id, away_team_id, home_score, away_score, status_state, status_detail, period, display_clock, venue, updated_at)`
- `player_stats(game_espn_id, team_espn_id, player_name, position, stat_category, stat_keys, stat_values, updated_at)`

## Deployment

**Docker:**

```bash
docker build -t football-insider-api .
docker run -p 3000:3000 football-insider-api
```

**Vercel:** `vercel.json` deploys `src/app.js` (the Express app, no
listener) as a serverless function; SQLite lives in `/tmp` there. Vercel's
serverless functions don't hold a persistent WebSocket connection or an
in-process poll loop, so for live `scores:update` push in production, deploy
to a long-running host (Docker/Render/Fly/a VM) instead — the REST endpoints
work identically either way.

## Known limitations (MVP scope)

- Player stats are fetched per game on demand, not pre-crawled for every game.
- Boxscore rows don't carry a position (ESPN's boxscore omits it).
- The cache is in-process; running several instances would need Redis
  (only `src/cache.js` changes).
