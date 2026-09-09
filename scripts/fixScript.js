const fs = require('fs');
const path = require('path');

const contentPath = 'C:/Users/ALTAF Hossen/.gemini/antigravity-ide/brain/6fb05b32-37bf-4ee9-9c65-0c4c6d6e566e/.system_generated/steps/392/content.md';
const content = fs.readFileSync(contentPath, 'utf8');

const regex = /https:\/\/kidsworldbd\.com\/wp-content\/uploads\/[^\s"'\\]+\.(?:jpg|png|webp)/g;
let urls = [...new Set(content.match(regex))];
urls = urls.filter(url => !url.includes('-150x') && !url.includes('-100x') && !url.includes('-768x'));

const seedScriptPath = path.join(__dirname, 'seedKidsWorldProducts.js');
let seedScript = fs.readFileSync(seedScriptPath, 'utf8');

const arrStr = JSON.stringify(urls, null, 4);

// Replace the try/catch block that failed
seedScript = seedScript.replace(/const contentPath = path\.join\([\s\S]*?\} catch \(e\) \{[\s\S]*?\n\}/, `let imageUrls = ${arrStr};`);

fs.writeFileSync(seedScriptPath, seedScript, 'utf8');
console.log('Successfully injected real images into seedKidsWorldProducts.js');
