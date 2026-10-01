# American Football Insider API

Real-time NFL data aggregation API providing live game scores, team statistics, and performance analytics.

## Features

- **Real-time Game Data**: Live NFL game scores and schedules
- **Team Statistics**: Comprehensive team performance metrics (passing, rushing, receiving yards)
- **Intelligent Caching**: 5-minute TTL cache layer for optimal performance
- **SQLite Database**: Persistent storage for game history and stats
- **REST API**: Clean, intuitive endpoints for all data types
- **CORS Support**: Cross-origin requests enabled

## Installation

```bash
npm install
```

## Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

The API will start on `http://localhost:3000` (or port specified in `.env`)

## API Endpoints

### Health Check
```
GET /api/health
```
Returns server status and timestamp.

### Games
```
GET /api/games
```
Get all games for the current season. Query parameters:
- `week` (optional): Filter by week number
- `season` (optional, default: 2024): Filter by season

```
GET /api/games/:gameId
```
Get a specific game by ID.

```
POST /api/games/:gameId/sync
```
Sync a game to the database.

### Teams
```
GET /api/teams
```
Get all NFL teams.

```
GET /api/teams/:teamId
```
Get a specific team by ID (e.g., 'KC' for Kansas City Chiefs).

```
POST /api/teams/:teamId/sync
```
Sync a team to the database.

### Stats
```
GET /api/stats/team/:teamId
```
Get statistics for a team. Query parameters:
- `season` (optional, default: 2024): Filter by season

```
POST /api/stats/team/:teamId/cache-refresh
```
Force refresh team stats cache.

## Example Requests

### Get all games
```bash
curl http://localhost:3000/api/games
```

### Get games for week 1
```bash
curl http://localhost:3000/api/games?week=1
```

### Get Kansas City Chiefs
```bash
curl http://localhost:3000/api/teams/KC
```

### Get team stats
```bash
curl http://localhost:3000/api/stats/team/KC
```

## Response Format

All responses follow this structure:
```json
{
  "success": true,
  "data": {},
  "timestamp": "2024-09-05T10:30:00.000Z"
}
```

## Database Schema

### games table
- `id`: Auto-incrementing ID
- `game_id`: Unique game identifier
- `week`: Week number
- `season`: NFL season year
- `home_team`: Home team name
- `away_team`: Away team name
- `home_score`: Home team score
- `away_score`: Away team score
- `game_date`: Game date (YYYY-MM-DD)
- `status`: Game status (upcoming, live, final)

### team_stats table
- `id`: Auto-incrementing ID
- `team_id`: Team identifier
- `team_name`: Team name
- `season`: NFL season
- `week`: Week number
- `passing_yards`: Total passing yards
- `rushing_yards`: Total rushing yards
- `receiving_yards`: Total receiving yards
- `total_points`: Points scored

### teams table
- `id`: Auto-incrementing ID
- `team_id`: Unique team identifier
- `team_name`: Full team name
- `city`: City name
- `division`: NFL division (e.g., AFC West)
- `conference`: Conference (AFC or NFC)
- `coach`: Head coach name

## Caching Strategy

The API implements a multi-layer caching strategy:
- **Game Cache**: 5-minute TTL for game data
- **Team Cache**: 1-hour TTL for team roster data
- **Stats Cache**: 5-minute TTL for team statistics

Clear cache by restarting the server or using the cache-refresh endpoints.

## Environment Variables

Create a `.env` file:
```
PORT=3000
NODE_ENV=development
```

## Performance Optimizations

- Database indices on frequently queried columns (game_date, status, team_id)
- Response caching with configurable TTL
- Connection pooling for database operations
- Efficient query filtering and pagination ready

## Error Handling

All errors return appropriate HTTP status codes:
- `400`: Bad request
- `404`: Resource not found
- `500`: Server error

## Testing

```bash
npm test
```

## License

MIT

## Support

For issues or questions, visit the [GitHub repository](https://github.com/patrickrosenfelder-tech/american-football-insider).
