const NodeCache = require('node-cache');

// Initialize cache with a standard TTL of 60 seconds (1 minute)
// checkperiod: 120 means the cache will clean up expired items every 2 minutes to free memory
const myCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

/**
 * Clears all cached product data.
 * Call this whenever a product is created, updated, deleted, or stock changes.
 */
const clearProductCache = () => {
    myCache.flushAll();
    console.log('[Cache] Product cache flushed.');
};

module.exports = {
    myCache,
    clearProductCache
};
