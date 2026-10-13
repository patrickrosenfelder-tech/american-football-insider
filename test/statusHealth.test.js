jest.mock('../src/db/database', () => ({ loadDataset: jest.fn(async () => null), saveDataset: jest.fn(async () => {}) }));
jest.mock('../src/jobs/scheduler', () => ({ describe: jest.fn(() => []) }));
const { runJob, status } = require('../src/jobs/refresh');
const scheduler = require('../src/jobs/scheduler');
const news = require('../src/services/newsService');
const social = require('../src/services/socialService');
const picks = require('../src/services/picksService');
const { buildStatus } = require('../src/routes/status');

beforeEach(() => {
  Object.keys(status).forEach((k) => delete status[k]);
  jest.useFakeTimers().setSystemTime(new Date('2026-10-10T12:00:00Z'));
  jest.spyOn(news, 'status').mockResolvedValue({ llm: [], runs: [] });
  jest.spyOn(social, 'status').mockResolvedValue({});
  jest.spyOn(picks, 'predictionStatus').mockResolvedValue({ available: true, generated_at: '2026-10-10T12:00:00Z', model_version: 'v2.1.0' });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('partial failure is degraded and preserves the last complete success; recovery retains only historical errors', async () => {
  const success = await runJob('weather', async () => ({ games: 15 }));
  jest.advanceTimersByTime(1000);
  const partial = await runJob('weather', async () => ({ games: 15, error: '3/15 games failed: HTTP 429' }));
  expect(partial).toMatchObject({ ok: false, degraded: true, last_success: success.last_success, last_attempt_error: '3/15 games failed: HTTP 429' });
  scheduler.describe.mockReturnValue([{ job: 'weather', ...partial }]);
  const degraded = (await buildStatus()).sources.find((s) => s.source === 'weather');
  expect(degraded.state).toBe('degraded');
  jest.advanceTimersByTime(1000);
  const recovered = await runJob('weather', async () => ({ games: 15 }));
  expect(recovered).toMatchObject({ ok: true, degraded: false, last_attempt_error: null, last_error: partial.last_error });
  scheduler.describe.mockReturnValue([{ job: 'weather', ...recovered }]);
  const healthy = (await buildStatus()).sources.find((s) => s.source === 'weather');
  expect(healthy.state).toBe('ok'); expect(healthy.last_attempt_error).toBeNull();
});

test('total failure is error and cannot advance last success', async () => {
  const result = await runJob('rosters_depth', async () => { throw new Error('32/32 teams failed: timeout'); });
  expect(result).toMatchObject({ ok: false, degraded: false, last_success: null });
  scheduler.describe.mockReturnValue([{ job: 'rosters_depth', ...result }]);
  expect((await buildStatus()).sources.find((s) => s.source === 'rosters').state).toBe('error');
});

test('legacy ok status with simultaneous error is shown as degraded', async () => {
  scheduler.describe.mockReturnValue([{ job: 'rosters_depth', ok: true, last_success: '2026-10-10T12:00:00Z', last_run: '2026-10-10T12:00:00Z', last_error_at: '2026-10-10T12:00:00Z', last_error: '32/32 teams failed' }]);
  expect((await buildStatus()).sources.find((s) => s.source === 'rosters').state).toBe('degraded');
});
