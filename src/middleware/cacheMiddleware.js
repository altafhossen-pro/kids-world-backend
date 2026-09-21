const { myCache } = require('../utils/cache');

const cacheMiddleware = (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
        return next();
    }

    // Generate cache key based on the exact requested URL (including query parameters)
    const key = req.originalUrl || req.url;
    
    // Check if we have a cached response for this key
    const cachedResponse = myCache.get(key);

    if (cachedResponse) {
        // Return the cached JSON directly
        return res.json(cachedResponse);
    } else {
        // Hook into res.json to capture the response body before sending it
        const originalJson = res.json.bind(res);

        res.json = (body) => {
            // Only cache successful (200 OK) responses that are successful JSON structures
            if (res.statusCode === 200 && body && body.success !== false) {
                try {
                    // Stringify and parse to strip Mongoose prototypes before caching
                    const cleanBody = JSON.parse(JSON.stringify(body));
                    myCache.set(key, cleanBody);
                } catch (e) {
                    console.error('Cache stringify error:', e);
                }
            }
            // Send the response using the original res.json method
            return originalJson(body);
        };
        next();
    }
};

module.exports = cacheMiddleware;
