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

const del = (key) => cache.del(key);

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

module.exports = {
  initialize,
  get,
  set,
  del,
  flush,
  getOrSet
};
