const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

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
  if (cached) {
    console.log(`Cache HIT: ${key}`);
    return cached;
  }

  console.log(`Cache MISS: ${key}`);
  const data = await fetchFn();
  cache.set(key, data, ttl);
  return data;
};

module.exports = {
  initialize,
  get,
  set,
  del,
  flush,
  getOrSet
};
