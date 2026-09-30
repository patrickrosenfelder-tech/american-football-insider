# American Football Insider API

NFL insider/analytics backend: real-time multi-source score aggregation, team
and player data, and a caching + SQLite persistence layer, built for the
American Football Insider project.

Data source: ESPN's public NFL site API (no API key required). The service
fetches, normalizes, caches, and persists it — it isn't just a proxy.

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

Copy `.env.example` to `.env` to override defaults (port, cache TTLs, poll
interval, DB path).

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/api/teams` | All 32 NFL teams (cached, seeded from ESPN) |
| GET | `/api/teams/:id` | Team detail + roster + record (ESPN team id) |
| GET | `/api/games/scoreboard?week=&season=&seasontype=` | Live/scheduled scores for a week (defaults to current week) |
| GET | `/api/games/db?week=&season=&seasontype=` | Same data served straight from the local SQLite cache |
| GET | `/api/games/:id` | Game detail: final/live score, team stats, full player boxscore (ESPN event id) |
| GET | `/api/stats/game/:id` | Player stats for a game, read from SQLite |
| GET | `/api/standings` | Conference standings |
| WS | (default namespace) | Emits `connected` on connect, `scores:update` when any game's score/status changes |

### Example

```bash
curl http://localhost:3000/api/games/scoreboard
curl http://localhost:3000/api/teams/22          # Arizona Cardinals
curl http://localhost:3000/api/games/401872948   # completed game with full boxscore
```

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

**Vercel:** `vercel.json` is included for the REST surface. Vercel's
serverless functions don't hold a persistent WebSocket connection or an
in-process poll loop, so for live `scores:update` push in production, deploy
to a long-running host (Docker/Render/Fly/a VM) instead — the REST endpoints
work identically either way.

## Known limitations (MVP scope)

- `conference` / `division` on `/api/teams` are `null` — ESPN's team list
  endpoint doesn't include them (only the per-team detail call does); can be
  backfilled with a static division map if needed.
- Player stats are only populated once `/api/games/:id` has been fetched for
  that game (on demand, not pre-crawled for every game).
