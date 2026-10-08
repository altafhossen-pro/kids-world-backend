const mongoose = require('mongoose');
require('dotenv').config();

async function fixProductSkuIndex() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not defined in .env');
    process.exit(1);
  }

  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    const collection = mongoose.connection.collection('products');
    const indexes = await collection.indexes();
    console.log('📋 Current product indexes count:', indexes.length);

    // 1. Check if old variants.sku_1 index exists
    const oldIndex = indexes.find(i => i.name === 'variants.sku_1');
    if (oldIndex) {
      const hasPartial = !!oldIndex.partialFilterExpression;
      console.log(`🔍 Found existing 'variants.sku_1' (unique: ${oldIndex.unique}, partial: ${hasPartial})`);
      
      if (!hasPartial) {
        console.log('🗑️ Dropping old non-partial variants.sku_1 index...');
        await collection.dropIndex('variants.sku_1');
        console.log('✅ Old index dropped successfully.');
      } else {
        console.log('ℹ️ Index already has partialFilterExpression.');
      }
    }

    // 2. Create the partial unique index
    console.log('⚙️ Creating partial unique index for variants.sku...');
    const result = await collection.createIndex(
      { 'variants.sku': 1 },
      {
        unique: true,
        partialFilterExpression: { 'variants.0': { $exists: true } },
        name: 'variants.sku_1',
        background: true
      }
    );
    console.log(`✅ Index verified/created successfully: ${result}`);

    console.log('\n🎉 ALL DONE! Simple products can now be created without SKU duplicate errors.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

fixProductSkuIndex();
