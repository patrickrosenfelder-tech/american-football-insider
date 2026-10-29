const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });
// Coalesce concurrent cache misses. Without this, a burst of requests after a
// deploy starts identical upstream calls (ESPN is particularly expensive),
// increasing latency and memory use exactly when the instance is cold.
const pending = new Map();

const initialize = () => {
  console.log('Cache initialized with 5-minute TTL');
};

const get = (key) => cache.get(key);

const set = (key, value, ttl = 300) => {
  cache.set(key, value, ttl);
};

const del = (key) => cache.del([key, `${key}:stale`]);

const flush = () => cache.flushAll();

const getOrSet = async (key, fetchFn, ttl = 300) => {
  const cached = cache.get(key);
  if (cached !== undefined) {
    console.log(`Cache HIT: ${key}`);
    return cached;
  }

  if (pending.has(key)) {
    console.log(`Cache WAIT: ${key}`);
    return pending.get(key);
  }

  console.log(`Cache MISS: ${key}`);
  const request = Promise.resolve()
    .then(fetchFn)
    .then((data) => {
      cache.set(key, data, ttl);
      return data;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
};

// Serve the last successful value while a refresh happens in the background.
// This is useful for slow, non-live feeds such as standings: an expired value is
// still much more useful than making a visitor wait on an upstream request.
const getOrSetStale = async (key, fetchFn, ttl = 300, staleTtl = 0) => {
  const cached = cache.get(key);
  if (cached !== undefined) {
    console.log(`Cache HIT: ${key}`);
    return cached;
  }

  const staleKey = `${key}:stale`;
  const stale = cache.get(staleKey);
  const load = () => {
    if (pending.has(key)) return pending.get(key);
    console.log(`Cache MISS: ${key}`);
    const request = Promise.resolve()
      .then(fetchFn)
      .then((data) => {
        cache.set(key, data, ttl);
        // Keep a separately-expiring copy. NodeCache removes the fresh entry at
        // ttl, so the stale copy must include both windows.
        cache.set(staleKey, data, ttl + staleTtl);
        return data;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };

  if (stale !== undefined) {
    console.log(`Cache STALE: ${key}`);
    // A failed background refresh intentionally leaves the previous value
    // available until its stale window ends.
    load().catch((error) => console.error(`Cache refresh failed: ${key}:`, error.message));
    return stale;
  }
  return load();
};

module.exports = {
  initialize,
  get,
  set,
  del,
  flush,
  getOrSet,
  getOrSetStale
};
