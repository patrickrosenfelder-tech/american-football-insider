const cache = require('../src/cache/cacheManager');

beforeEach(() => cache.flush());
afterEach(() => { cache.flush(); jest.restoreAllMocks(); });

test('serves a stale standings result immediately and refreshes it once in the background', async () => {
  const key = 'standings-test';
  cache.set(`${key}:stale`, { season: 2026 });
  let resolveRefresh;
  const refresh = jest.fn(() => new Promise((resolve) => { resolveRefresh = resolve; }));

  await expect(cache.getOrSetStale(key, refresh, 60, 60)).resolves.toEqual({ season: 2026 });
  expect(refresh).toHaveBeenCalledTimes(1);

  // Concurrent callers reuse the one refresh rather than starting a stampede.
  await expect(cache.getOrSetStale(key, refresh, 60, 60)).resolves.toEqual({ season: 2026 });
  expect(refresh).toHaveBeenCalledTimes(1);

  resolveRefresh({ season: 2027 });
  await new Promise(setImmediate);
  await expect(cache.getOrSetStale(key, refresh, 60, 60)).resolves.toEqual({ season: 2027 });
});
