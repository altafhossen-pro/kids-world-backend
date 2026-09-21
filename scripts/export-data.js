const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Category } = require('../src/modules/category/category.model');
const { Product } = require('../src/modules/product/product.model');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gold-ecommerce';

async function exportData() {
  try {
    console.log('Connecting to MongoDB...', MONGO_URI);
    await mongoose.connect(MONGO_URI);
    console.log('Connected!');

    // Export Categories
    const categories = await Category.find({}).lean();
    console.log(`Found ${categories.length} categories.`);
    
    // Export Products
    const products = await Product.find({}).lean();
    console.log(`Found ${products.length} products.`);

    const exportDir = path.join(__dirname, 'export_data');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir);
    }

    const categoriesPath = path.join(exportDir, 'categories-export.json');
    const productsPath = path.join(exportDir, 'products-export.json');

    fs.writeFileSync(categoriesPath, JSON.stringify(categories, null, 2));
    fs.writeFileSync(productsPath, JSON.stringify(products, null, 2));

    console.log(`\nExport complete! Files saved to:`);
    console.log(`- ${categoriesPath}`);
    console.log(`- ${productsPath}`);

    process.exit(0);
  } catch (error) {
    console.error('Export failed:', error);
    process.exit(1);
  }
}

exportData();
