const http = require('http');

function measureTime() {
    return new Promise((resolve) => {
        const start = Date.now();
        http.get('http://localhost:5000/api/v1/products/bestselling?limit=10', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const end = Date.now();
                resolve(end - start);
            });
        });
    });
}

async function test() {
    console.log('Fetching first time (should hit DB)...');
    const time1 = await measureTime();
    console.log(`First request took: ${time1}ms`);

    console.log('Fetching second time (should hit cache)...');
    const time2 = await measureTime();
    console.log(`Second request took: ${time2}ms`);
}

test();
