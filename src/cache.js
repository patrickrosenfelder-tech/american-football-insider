const NodeCache = require('node-cache');

// Single in-memory cache shared across services. Swappable for Redis later:
// only this module would need to change, since callers only use get/wrap.
const store = new NodeCache({ checkperiod: 60 });

/**
 * Returns the cached value for `key`, or calls `fetchFn`, caches the result
 * for `ttlSeconds`, and returns it. Concurrent callers for the same cold key
 * share one in-flight fetch instead of each hitting the upstream API.
 */
const inFlight = new Map();

async function wrap(key, ttlSeconds, fetchFn) {
  const cached = store.get(key);
  if (cached !== undefined) return cached;

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    try {
      const value = await fetchFn();
      store.set(key, value, ttlSeconds);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

function invalidate(key) {
  store.del(key);
}

function stats() {
  return store.getStats();
}

module.exports = { wrap, invalidate, stats };
