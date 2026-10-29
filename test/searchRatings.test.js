jest.mock('../src/db/database', () => ({ loadDataset: jest.fn(async () => null), saveDataset: jest.fn(async () => {}) }));
jest.mock('../src/services/newsService', () => ({
  buildIndex: jest.fn(async () => ({
    teams: [{ id: '12', abbreviation: 'KC', name: 'Kansas City Chiefs', short_name: 'Chiefs', location: 'Kansas City', logo: 'kc.png' },
      { id: '9', abbreviation: 'GB', name: 'Green Bay Packers', short_name: 'Packers', location: 'Green Bay', logo: 'gb.png' }],
    players: new Map([['patrick mahomes', { id: '3139477', name: 'Patrick Mahomes', team: 'KC', position: 'QB' }],
      ['jordan love', { id: '4036378', name: 'Jordan Love', team: 'GB', position: 'QB' }]])
  }))
}));
jest.mock('../src/services/sportsDataService', () => ({
  getUpcomingScoreboard: jest.fn(async () => ({ games: [
    { game_id: '1', date: '2026-10-30T00:15Z', status: { state: 'pre', detail: 'Thu 8:15 PM' }, home: { abbreviation: 'GB' }, away: { abbreviation: 'CAR' } },
    { game_id: '2', date: '2026-11-02T18:00Z', status: { state: 'post', detail: 'Final' }, home: { abbreviation: 'KC' }, away: { abbreviation: 'DEN' } }
  ] }))
}));
const { search, rank } = require('../src/services/searchService');
const ratings = require('../src/services/ratingsService');

test('search finds teams by name, nickname or abbreviation, with their games', async () => {
  const r = await search('packers');
  expect(r.teams.map((t) => t.abbreviation)).toEqual(['GB']);
  expect(r.games).toEqual([expect.objectContaining({ name: 'CAR @ GB', url: '/preview/1' })]);
  expect((await search('kc')).teams[0]).toMatchObject({ abbreviation: 'KC', url: '/teams/KC' });
});

test('search finds players by last name and links finished games to the game page', async () => {
  const r = await search('mahomes');
  expect(r.players).toEqual([expect.objectContaining({ name: 'Patrick Mahomes', url: '/players/3139477' })]);
  expect(r.games).toEqual([expect.objectContaining({ url: '/game/2' })]);
  expect((await search('a')).players).toEqual([]);
});

test('rank prefers exact, then prefix, then word prefix, then substring', () => {
  expect(rank('jordan love', 'Jordan Love')).toBe(4);
  expect(rank('jor', 'Jordan Love')).toBe(3);
  expect(rank('lov', 'Jordan Love')).toBe(2);
  expect(rank('love', 'Jordan Love')).toBeGreaterThan(rank('love', 'Colston Loveland'));
  expect(rank('rdan', 'Jordan Love')).toBe(1);
});

test('ratings publish rejects anything but a v3 artifact with teams', async () => {
  await expect(ratings.saveRatings({ model_version: 'v2.1.0', teams: [{}] })).rejects.toMatchObject({ status: 400 });
  await expect(ratings.saveRatings({ model_version: 'v3.2', teams: [] })).rejects.toMatchObject({ status: 400 });
  await expect(ratings.saveRatings({ model_version: 'v3.2', week: 8, teams: [{ team: 'KC' }] })).resolves.toMatchObject({ teams: 1, week: 8 });
});

test('bundled ratings and backtest artifacts load', async () => {
  const r = await ratings.getRatings();
  expect(r.teams).toHaveLength(32);
  expect(r.teams[0]).toEqual(expect.objectContaining({ rank: 1, base_elo: expect.any(Number), groups: expect.any(Object) }));
});
