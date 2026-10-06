# American Football Insider

Live NFL scores, standings, team pages and game breakdowns. An Express API that wraps free public data sources, with a React (Vite) UI served by the same server.

**Live:** https://american-football-insider.fly.dev

## Features

- **Scores**: this week's games grouped by day, with a week picker for the whole season. Live games auto-refresh every 30s and show down & distance and possession.
- **Standings**: all 8 divisions with W/L/T, PCT, PF/PA, differential, streak and current playoff seed.
- **Teams**: all 32 teams by division. Each team page shows record, standing, bye week, full schedule with results, and season stats (scoring, passing, rushing, receiving, situational, defense).
- **Game detail**: linescore, team stat comparison, game leaders (season leaders before kickoff), scoring plays, betting line, venue, broadcast and related news.
- Mobile-friendly, light and dark mode.

## Run locally

Requires Node 20+.

```bash
npm install
npm run build          # builds the React app into client/dist
PORT=3002 npm start    # http://localhost:3002  (3002 is the default)
```

Ports 3000 and 3001 are used by other services on the dev Mac, so the default port is **3002** (see `.env.example`).

Frontend development with hot reload: run `npm start` (API on 3002) and `npm run dev:client` (Vite on http://localhost:5173, which proxies `/api` to 3002).

## API

All responses are JSON. Data responses follow the shape `{ success, data, timestamp }`.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/games` | Current week's scoreboard (also returns `season`, `week`, `calendar`, `teams_on_bye`) |
| `GET /api/games?week=5[&season=2026][&seasontype=2]` | A specific week (`seasontype`: 1 pre, 2 regular, 3 post) |
| `GET /api/games/:gameId` | Game detail: linescore, team stats, leaders, scoring plays, news |
| `GET /api/standings` | Standings by conference and division |
| `GET /api/teams` | All 32 teams with conference, division and record |
| `GET /api/teams/:teamId` | Team detail and schedule (`:teamId` = abbreviation like `KC`, or ESPN id) |
| `GET /api/stats/team/:teamId[?season=2026]` | Team season stats |
| `POST /api/stats/team/:teamId/cache-refresh` | Bust the stats cache for a team |
| `POST /api/games/:gameId/sync`, `POST /api/teams/:teamId/sync` | Persist a snapshot to SQLite |

Example:

```bash
curl -s localhost:3002/api/games | jq '.week, .data[0] | {short_name, status, home: .home.score, away: .away.score}'
```

## Data sources

All data comes from ESPN's **public, keyless** JSON endpoints. No API key or paid plan is needed.

- Scoreboard / schedule: `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
- Game summary: `.../nfl/summary?event=<id>`
- Teams, team schedule, team statistics: `.../nfl/teams`, `.../teams/<id>/schedule`, `.../teams/<id>/statistics`
- Standings: `site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3`

Responses are cached in memory (`node-cache`): 30s while a game is live, 5 min for an idle scoreboard, 10 min for standings, 30 min for stats and 1 h for teams and final games. These endpoints are unofficial and undocumented, so ESPN can change them without notice. Normalization lives in `src/services/sportsDataService.js`, so fixes stay in one place.

## Deploy (Fly.io)

The app runs on Fly.io as `american-football-insider`: one shared-cpu machine in `iad`, no HA, and auto-stop when idle (the first request after idling takes a second or two to wake it).

```bash
flyctl deploy --ha=false --remote-only
flyctl status -a american-football-insider
flyctl logs -a american-football-insider
```

The `Dockerfile` builds the React app and prunes dev dependencies. The container listens on port 8080. The health check is `GET /api/health`.

## Project layout

```
src/
  app.js                      Express app: API routes + static client/dist with SPA fallback
  services/sportsDataService.js  ESPN fetching + normalization + caching
  routes/                     games, teams, stats, standings
  cache/cacheManager.js       node-cache wrapper
  db/database.js              SQLite (optional snapshot storage; DB_PATH env)
client/                       React app (Vite): pages/Scores, Standings, Teams, Team, Game
```

## Open items

- No automated tests yet. Jest is configured but there are no specs. Next step: unit tests for the normalizers using recorded ESPN fixtures.
- The ESPN feed is unofficial. Add a fallback source and alerting if the response shape changes.
- SQLite on Fly is ephemeral (`/tmp`). The sync endpoints are only snapshots. If history matters, move to Postgres (e.g. Neon, as TuneDuel does) or attach a Fly volume.
- Ideas: player pages and league leaders, injury reports, news feed on the home page, odds and predictions, push or SSE for live scores instead of polling.
- No custom domain yet (currently `*.fly.dev`).
