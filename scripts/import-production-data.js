const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Category } = require('../src/modules/category/category.model');
const { Product } = require('../src/modules/product/product.model');
const { Order } = require('../src/modules/order/order.model');

// Optional models that might not be exported directly or might not exist
let StockTracking;
try {
  const stockMod = require('../src/modules/inventory/stockTracking.model');
  StockTracking = stockMod.StockTracking || stockMod;
} catch (e) {
  console.log('StockTracking model not found, skipping...');
}

const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('ERROR: MONGODB_URI is not set in .env file!');
  process.exit(1);
}

async function importData() {
  try {
    console.log('WARNING: THIS SCRIPT WILL WIPE EXISTING CATEGORIES, PRODUCTS, AND ORDERS!');
    console.log('Connecting to MongoDB...', MONGO_URI.replace(/:([^:@]+)@/, ':****@')); // Hide password
    await mongoose.connect(MONGO_URI);
    console.log('Connected!');

    // 1. Wipe Phase
    console.log('--- WIPING DATA ---');
    await Category.deleteMany({});
    console.log('Categories wiped.');
    
    await Product.deleteMany({});
    console.log('Products wiped.');
    
    if (Order) {
      await Order.deleteMany({});
      console.log('Orders wiped.');
    }
    
    if (StockTracking && typeof StockTracking.deleteMany === 'function') {
      await StockTracking.deleteMany({});
      console.log('Stock Tracking wiped.');
    }

    // 2. Import Phase
    console.log('--- IMPORTING DATA ---');
    const dataDir = path.join(__dirname, 'data');
    const categoriesPath = path.join(dataDir, 'categories-export.json');
    const productsPath = path.join(dataDir, 'products-export.json');

    if (!fs.existsSync(categoriesPath) || !fs.existsSync(productsPath)) {
      throw new Error(`Data files not found in ${dataDir}. Did you unzip migration-package.zip here?`);
    }

    let categoriesJson = fs.readFileSync(categoriesPath, 'utf8');
    let productsJson = fs.readFileSync(productsPath, 'utf8');

    // Replace localhost URLs with production BACKEND_URL
    const backendUrl = process.env.BACKEND_URL;
    if (backendUrl && backendUrl !== 'http://localhost:5000') {
      console.log(`Replacing 'http://localhost:5000' with '${backendUrl}' in images...`);
      categoriesJson = categoriesJson.replace(/http:\/\/localhost:5000/g, backendUrl);
      productsJson = productsJson.replace(/http:\/\/localhost:5000/g, backendUrl);
    } else {
      console.log('WARNING: BACKEND_URL is either not set or set to localhost. URLs will not be changed.');
      console.log('Please set BACKEND_URL=https://your-production-domain.com in your production .env file!');
    }

    const categories = JSON.parse(categoriesJson);
    const products = JSON.parse(productsJson);

    // Insert Categories
    if (categories.length > 0) {
      await Category.insertMany(categories);
      console.log(`Successfully imported ${categories.length} categories.`);
    }

    // Insert Products
    if (products.length > 0) {
      await Product.insertMany(products);
      console.log(`Successfully imported ${products.length} products.`);
    }

    console.log('\n✅ MIGRATION COMPLETE! ✅');
    console.log('Please copy the contents of the "uploads" folder to your backend root if you haven\'t already.');
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

importData();
