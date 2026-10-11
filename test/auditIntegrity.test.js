jest.mock('../src/db/database', () => ({ loadDataset: jest.fn(), saveDataset: jest.fn() }));
const { deriveByeWeek } = require('../src/services/scheduleIntegrity');
const { presentPick } = require('../src/services/pickPresentation');
const { applyPythonPrediction } = require('../src/services/picksService');
const { safeStory, isNflStory } = require('../src/services/newsIntegrity');
const { tagTeams } = require('../src/services/socialService');

const originalPick = () => ({ home: 'JAX', away: 'PHI', model_version: 'v1',
  model: { home_margin: 12, spread_home: -12, home_win_prob: 81, total: 43.4 },
  market: { spread_home: -7.5, total: 41.5, moneyline_home: -395, moneyline_away: 310 },
  spread: { side: 'home', team: 'JAX', line: -7.5 },
  total: { side: 'over', line: 41.5 }, moneyline: { side: 'home', team: 'JAX', model_prob: 81 },
  confidence_edge: 4.5, confidence_stars: 3, reasoning: 'JAX wins 81% and is a 12-point favorite.' });

test('Python override replaces the old narrative, probability, edge and stars together', () => {
  const p = applyPythonPrediction(originalPick(), { home_margin: -6, home_win_probability: .331, model_version: 'v2.1.0' });
  expect(p.spread).toMatchObject({ team: 'PHI', line: 7.5, edge: 13.5 });
  expect(p.moneyline).toMatchObject({ team: 'PHI', model_prob: 66.9 });
  expect(p).toMatchObject({ confidence_edge: 13.5, confidence_stars: 5 });
  expect(p.model.spread_home).toBe(6);
  expect(p.reasoning).toContain('PHI a 6-point favorite');
  expect(p.reasoning).toContain('PHI at 66.9%');
  expect(p.reasoning).toContain('5-star spread pick is PHI +7.5');
  expect(p.reasoning).not.toMatch(/JAX wins 81|12-point favorite/);
});

test('independent margin and probability models are explained separately', () => {
  const p = applyPythonPrediction(originalPick(), { home_margin: 6, home_win_probability: .4, model_version: 'v2.1.0' });
  expect(p.reasoning).toContain('JAX a 6-point favorite');
  expect(p.reasoning).toContain('PHI at 60%');
  expect(p.reasoning).toContain('estimated separately');
  expect(p.reasoning).not.toContain('JAX winning 60');
});

test.each([NaN, Infinity, null])('invalid margin %s falls back', (home_margin) => {
  expect(applyPythonPrediction(originalPick(), { home_margin, home_win_probability: .6 }).model_version).toBe('v1 (fallback)');
});
test.each([-1, 2, null, NaN])('invalid probability %s falls back', (home_win_probability) => {
  expect(applyPythonPrediction(originalPick(), { home_margin: 3, home_win_probability }).fallback_reason).toBe('invalid v2 prediction');
});

test('read-time repair preserves locked bets and graded outcomes without mutating storage', () => {
  const stored = { ...originalPick(), locked_at: '2026-10-08T00:00:00Z', result: { spread: 'W' } };
  const before = JSON.stringify(stored);
  const p = presentPick(stored);
  expect(p.spread).toEqual(stored.spread);
  expect(p.result).toEqual(stored.result);
  expect(p.locked_at).toBe(stored.locked_at);
  expect(p.confidence_stars).toBe(3);
  expect(JSON.stringify(stored)).toBe(before);
});

const fullSchedule = (bye) => ({ season: { type: 2 }, byeWeek: 5, events: Array.from({ length: 18 }, (_, i) => i + 1).filter((w) => w !== bye).map((number) => ({ season: { year: 2026 }, week: { number } })) });
test('Buffalo provider bye 5 is corrected to its full-schedule gap, week 7', () => {
  expect(deriveByeWeek(fullSchedule(7))).toBe(7);
});
test('partial schedules cannot produce an inferred bye', () => {
  const s = fullSchedule(7); s.events.pop(); expect(deriveByeWeek(s)).toBeNull();
});
test('preseason/postseason games do not establish a regular-season bye', () => {
  const s = fullSchedule(7); s.season.type = 3; expect(deriveByeWeek(s)).toBeNull();
});

const story = (extra = {}) => ({ kind: 'headline', title: 'Eagles rule out Barkley and Smith against Jaguars',
  ai_title: 'Barkley, Smith Ruled Out for Eagles-Lions London Game',
  sources: [{ title: 'Eagles rule out Barkley and Smith against Jaguars', snippet: 'Philadelphia faces Jacksonville in London.' }],
  summary: 'The Eagles ruled out two players. They face the Jaguars in London.', ai: { provider: 'test' }, ...extra });
test('old hallucinated opponent titles fall back to the source title', () => {
  const repaired = safeStory(story());
  expect(repaired.ai_title).toBeNull();
  expect(repaired.title).toBe('Eagles rule out Barkley and Smith against Jaguars');
  expect(repaired.summary).toBeTruthy();
});
test('a hallucinated opponent in a summary suppresses the summary and AI badge', () => {
  const repaired = safeStory(story({ summary: 'The Eagles face the Lions.' }));
  expect(repaired.summary).toBeNull(); expect(repaired.ai).toBeNull();
});
test('valid generated titles and structured data stories remain intact', () => {
  expect(safeStory(story({ ai_title: 'Eagles lose two starters before Jaguars game' })).ai_title).toBe('Eagles lose two starters before Jaguars game');
  const data = { kind: 'data', title: 'Injuries' }; expect(safeStory(data)).toBe(data);
});
test.each(['Cal gets back to .500 with dramatic win against Virginia Tech', 'FINAL: Houston Cougars 35, Kansas State Wildcats 16', 'Arch Manning interceptions doom Texas'])('college-only headline is omitted: %s', (title) => {
  expect(isNflStory(title)).toBe(false);
});
test('NFL draft and NFL team stories remain eligible', () => {
  expect(isNflStory('Penn State prospect declares for NFL draft')).toBe(true);
  expect(isNflStory('Eagles rule out Saquon Barkley')).toBe(true);
});
test('a Cowboys beat author discussing hockey does not create a Cowboys tag', () => {
  const index = { byId: {}, teamAliases: [{ re: /\bCowboys\b/i, team: { abbreviation: 'DAL' } }], players: new Map() };
  expect(tagTeams({ text: 'Tough loss for the Stars; good to see Tyler Seguin.', account_team: 'DAL' }, index)).toEqual([]);
  expect(tagTeams({ text: 'Cowboys announce injury updates', account_team: 'DAL' }, index)).toEqual(['DAL']);
  expect(tagTeams({ text: 'Cowboys update', account_team: 'DAL' }, null)).toEqual([]);
});
