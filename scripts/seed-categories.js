const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load env
dotenv.config({ path: path.join(__dirname, '../.env') });

const { Category } = require('../src/modules/category/category.model');
const { Product } = require('../src/modules/product/product.model');
const { Order } = require('../src/modules/order/order.model');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kids-worlds';

// Some random cute placeholder images
const placeholders = [
  'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=500&q=80',
  'https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=500&q=80',
  'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=500&q=80',
  'https://images.unsplash.com/photo-1558060370-d64111d52c14?w=500&q=80',
  'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=500&q=80',
  'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=500&q=80'
];

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to DB');

    console.log('Clearing Products, Orders, and Categories...');
    await Product.deleteMany({});
    await Order.deleteMany({});
    await Category.deleteMany({});
    console.log('Cleared successfully.');

    const dataPath = 'f:/Personal Projects/kids-worlds-jamuna/database-data/categories.json';
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(rawData);

    console.log(`Inserting ${data.categories.length} root categories...`);

    for (const root of data.categories) {
      const randomImg = placeholders[Math.floor(Math.random() * placeholders.length)];
      const newRoot = await Category.create({
        name: root.name,
        slug: root.slug,
        image: randomImg,
        parent: null,
        showOnHeader: true,
        showHomepageCategory: true
      });
      console.log(` - Created Root: ${newRoot.name}`);

      if (root.children && root.children.length > 0) {
        for (const child of root.children) {
          const childImg = placeholders[Math.floor(Math.random() * placeholders.length)];
          await Category.create({
            name: child.name,
            slug: child.slug,
            image: childImg,
            parent: newRoot._id,
            showOnHeader: false,
            showHomepageCategory: false
          });
          console.log(`    └─ Created Child: ${child.name}`);
        }
      }
    }

    console.log('All categories seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run();
