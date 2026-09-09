const fs = require('fs');
const path = require('path');

const contentPath = 'C:/Users/ALTAF Hossen/.gemini/antigravity-ide/brain/6fb05b32-37bf-4ee9-9c65-0c4c6d6e566e/.system_generated/steps/392/content.md';
const content = fs.readFileSync(contentPath, 'utf8');

const regex = /https:\/\/kidsworldbd\.com\/wp-content\/uploads\/[^\s"'\\]+\.(?:jpg|png|webp)/g;
const urls = [...new Set(content.match(regex))];

// Filter out very small thumbnail sizes (e.g., -150x150.jpg) and get the main images
let highQualityUrls = urls.filter(url => !url.includes('-150x150') && !url.includes('-100x100') && !url.includes('-768x768'));

if (highQualityUrls.length === 0) {
    highQualityUrls = urls; // Fallback
}

console.log(`Found ${highQualityUrls.length} unique image URLs.`);

const seedScriptPath = path.join(__dirname, 'seedKidsWorldProducts.js');
let seedScript = fs.readFileSync(seedScriptPath, 'utf8');

// Replace the imageUrls array with the new one
const newImageUrlsString = `const imageUrls = [\n    "${highQualityUrls.join('",\n    "')}"\n];`;
seedScript = seedScript.replace(/const imageUrls = \[[^\]]+\];/, newImageUrlsString);

// Also we should delete the existing products to avoid duplicates
seedScript = seedScript.replace(/\/\/ await Product\.deleteMany\({}\);/, 'await Product.deleteMany({});');

fs.writeFileSync(seedScriptPath, seedScript, 'utf8');
console.log('Successfully updated seedKidsWorldProducts.js with real images.');
