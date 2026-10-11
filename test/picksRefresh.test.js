jest.mock('../src/db/database', () => ({ loadDataset: jest.fn(), saveDataset: jest.fn() }));
jest.mock('../src/services/sportsDataService', () => ({ getScoreboard: jest.fn(), getUpcomingScoreboard: jest.fn() }));
jest.mock('../src/services/playoffService', () => ({ loadSeason: jest.fn(), phi: jest.fn(() => .6) }));
jest.mock('../src/services/teamStatsService', () => ({ getPlayedGames: jest.fn(async () => []), getTeamStats: jest.fn(async () => null) }));
jest.mock('../src/services/previewService', () => ({ getPreview: jest.fn(async () => null) }));
jest.mock('../src/services/weatherService', () => ({ gameWeather: jest.fn(async () => null) }));
jest.mock('../src/services/microMatchupService', () => ({ getMicroMatchups: jest.fn(async () => []), matchupAdjustment: jest.fn(() => ({ capped: 0, raw: 0 })) }));
jest.mock('../src/services/rosterService', () => ({ currentSeason: () => 2026 }));
jest.mock('../src/services/modelService', () => ({ explainPick: () => ({}) }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: () => false }));
const db = require('../src/db/database');
const sports = require('../src/services/sportsDataService');
const { loadSeason } = require('../src/services/playoffService');
const { getPicks, refreshPicks } = require('../src/services/picksService');
let state;
const game = { game_id: 'test', week: 5, date: '2026-10-11T17:00:00Z', status: { state: 'pre', completed: false }, home: { id: '1', abbreviation: 'JAX' }, away: { id: '2', abbreviation: 'PHI' }, lines: { spread_home: -7.5, total: 41.5 } };
const board = { season: 2026, season_type: 2, week: 5, games: [game] };
const modelSeason = { season: 2026, teams: [game.home, game.away], games: [] };
beforeEach(() => {
  jest.clearAllMocks(); state = { season: 2026, picks: {} };
  db.loadDataset.mockImplementation(async (key) => key === 'afi_picks_2026' ? { data: state } : null);
  db.saveDataset.mockImplementation(async (key, value) => { state = value; });
  sports.getScoreboard.mockResolvedValue(board); sports.getUpcomingScoreboard.mockResolvedValue(board);
});

test('cold reads return immediately, concurrent refreshes join, then saved picks appear', async () => {
  let release;
  loadSeason.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const first = await getPicks();
  expect(first.refresh_in_progress).toBe(true); expect(first.games[0].pick).toBeNull();
  const joined = refreshPicks({ week: 5 });
  const next = await getPicks(); expect(next.refresh_in_progress).toBe(true);
  expect(loadSeason).toHaveBeenCalledTimes(1);
  release(modelSeason); await joined;
  const ready = await getPicks();
  expect(ready.refresh_in_progress).toBe(false); expect(ready.games[0].pick).not.toBeNull();
  expect(db.saveDataset).toHaveBeenCalledTimes(1);
});

test('saved picks remain visible when a refresh fails, with a failure notice and retry cooldown', async () => {
  state = { season: 2026, updated_at: '2020-01-01T00:00:00Z', picks: { test: { home: 'JAX', away: 'PHI', week: 5, made_at: '2020-01-01T00:00:00Z', micro_matchup_version: 11, model_version: 'v1', model: { home_margin: 3, home_win_prob: 60, total: 44 }, market: { spread_home: -7.5 }, moneyline: { team: 'JAX', model_prob: 60 } } } };
  loadSeason.mockRejectedValue(new Error('upstream unavailable'));
  const first = await getPicks();
  expect(first.stale).toBe(true); expect(first.games[0].pick.home).toBe('JAX');
  await expect(refreshPicks({ week: 5 })).rejects.toThrow('upstream unavailable');
  const failed = await getPicks();
  expect(failed.refresh_error).toBe('upstream unavailable'); expect(failed.refresh_in_progress).toBe(false);
  expect(failed.games[0].pick).not.toBeNull(); expect(loadSeason).toHaveBeenCalledTimes(1);
});
