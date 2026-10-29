const rows = [];
jest.mock('../src/db/database', () => ({
  run: jest.fn(async (sql, params) => { rows.push({ sql, params }); }),
  get: jest.fn(async () => ({ at: null })),
  all: jest.fn(async () => [])
}));
jest.mock('../src/services/sportsDataService', () => ({ getUpcomingScoreboard: jest.fn() }));
jest.mock('../src/services/socialService', () => ({ list: jest.fn() }));
const sports = require('../src/services/sportsDataService');
const social = require('../src/services/socialService');
const marketLog = require('../src/services/marketLogService');

const lines = { provider: 'DraftKings', spread_home: -3.5, total: 47.5, moneyline_home: -192, moneyline_away: 160, spread_home_open: -7, total_open: 45.5, moneyline_home_open: -325, moneyline_away_open: 260 };

beforeEach(() => { rows.length = 0; jest.clearAllMocks(); });

test('line snapshot logs opening and current lines for upcoming games only, on the hour', async () => {
  sports.getUpcomingScoreboard.mockResolvedValue({ season: 2026, week: 8, games: [
    { game_id: '1', season: 2026, week: 8, date: '2026-10-30T00:15Z', status: { state: 'pre' }, home: { abbreviation: 'GB' }, away: { abbreviation: 'CAR' }, lines },
    { game_id: '2', date: '2026-10-29T17:00Z', status: { state: 'in' }, home: { abbreviation: 'BUF' }, away: { abbreviation: 'KC' }, lines },
    { game_id: '3', date: '2026-11-02T18:00Z', status: { state: 'pre' }, home: { abbreviation: 'DET' }, away: { abbreviation: 'MIN' }, lines: null }
  ] });
  const r = await marketLog.snapshotLines(new Date('2026-10-28T13:42:10Z'));
  expect(r).toMatchObject({ captured_at: '2026-10-28T13:00:00.000Z', games: 1, skipped_without_lines: 1 });
  expect(rows).toHaveLength(1);
  const p = rows[0].params;
  expect(p.slice(0, 2)).toEqual(['1', '2026-10-28T13:00:00.000Z']);
  expect(p.slice(8, 16)).toEqual([-3.5, 47.5, -192, 160, -7, 45.5, -325, 260]);
  expect(p[16]).toBe(Math.round((Date.parse('2026-10-30T00:15Z') - Date.parse('2026-10-28T13:42:10Z')) / 60000));
});

test('sentiment snapshot counts only team-tagged posts in the window, per team', async () => {
  social.list.mockResolvedValue({ posts: [
    { published: '2026-10-28T13:10:00Z', teams: ['GB'], platform: 'bluesky', insider: true, text: 'Jordan Love ruled out with a knee injury' },
    { published: '2026-10-28T13:20:00Z', teams: ['GB', 'CAR'], platform: 'youtube', text: 'Packers dominant win, Bryce Young benched' },
    { published: '2026-10-28T11:00:00Z', teams: ['GB'], platform: 'bluesky', text: 'old post' },
    { published: '2026-10-28T13:30:00Z', teams: [], platform: 'bluesky', text: 'no team' }
  ] });
  const r = await marketLog.snapshotSentiment(new Date('2026-10-28T13:45:00Z'));
  expect(r).toMatchObject({ posts: 2, teams: 2, window_start: '2026-10-28T12:00:00.000Z' });
  const gb = rows.find((x) => x.params[0] === 'GB').params;
  // posts, insider, positive, negative, injury
  expect(gb.slice(3, 8)).toEqual([2, 1, 2, 4, 3]);
});

test('lexicon scores injury words as negative and tallies them separately', () => {
  expect(marketLog.scorePost({ text: 'Placed on IR after a torn ACL' })).toEqual({ positive: 0, negative: 3, injury: 3 });
  expect(marketLog.scorePost({ text: 'activated and cleared, signs extension' })).toEqual({ positive: 4, negative: 0, injury: 0 });
});
