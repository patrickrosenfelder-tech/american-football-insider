jest.mock('../src/db/database', () => ({ loadDataset: jest.fn() }));
jest.mock('../src/services/sportsDataService', () => ({ getTeams: jest.fn(async () => [{ id: '1', abbreviation: 'PHI', name: 'Philadelphia Eagles' }, { id: '2', abbreviation: 'JAX', name: 'Jacksonville Jaguars' }]) }));
const db = require('../src/db/database');
const stamp = '2026-10-10T12:00:00Z';
const source = { name: 'Source', title: 'Eagles face Jaguars in London', snippet: 'The Eagles prepare for the Jaguars game.', url: 'https://example.com/source', published: stamp };
db.loadDataset.mockResolvedValue({ data: { stories: {
  invalidTitle: { id: 'invalidTitle', kind: 'headline', title: source.title, ai_title: 'Eagles face Lions in London', summary: 'The Eagles prepare for London. They face the Jaguars.', teams: ['PHI', 'JAX'], players: [], sources: [source], published: stamp },
  invalidSummary: { id: 'invalidSummary', kind: 'headline', title: source.title, summary: 'The Eagles face the Lions.', ai: { provider: 'test' }, teams: ['PHI'], players: [], sources: [source], published: stamp },
  college: { id: 'college', kind: 'headline', title: 'FINAL: Houston Cougars 35, Kansas State Wildcats 16', summary: 'College game result.', teams: [], players: [], sources: [{ ...source, title: 'Houston Cougars final', snippet: 'College football.' }], published: stamp }
}, updated_at: stamp } });
const news = require('../src/services/newsService');

test('list repairs legacy titles, rejects unsupported summaries and omits college-only content', async () => {
  const response = await news.list();
  expect(response.stories.map((s) => s.id)).toEqual(['invalidTitle']);
  expect(response.stories[0].title).toBe(source.title);
  expect(response.headlines.map((s) => s.id)).toEqual(['invalidSummary']);
});
test('story detail and list agree on the repaired title', async () => {
  expect((await news.get('invalidTitle')).title).toBe(source.title);
  expect((await news.get('invalidSummary')).summary).toBeNull();
});
test('news search filters both readable stories and pending headlines', async () => {
  expect((await news.list({ q: 'London' })).stories).toHaveLength(1);
  expect((await news.list({ q: 'London' })).headlines).toHaveLength(1);
  expect((await news.list({ q: 'unmatched search' })).stories).toHaveLength(0);
  expect((await news.list({ q: 'unmatched search' })).headlines).toHaveLength(0);
});
