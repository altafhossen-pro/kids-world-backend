const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/kids-worlds', { useNewUrlParser: true, useUnifiedTopology: true })
.then(async () => {
  const db = mongoose.connection.db;
  const products = await db.collection('products').find({}).toArray();
  for (let p of products) {
    let min = null, max = null;
    let basePrice = p.basePrice || 0;
    
    // If it's a variable product, it has priceRange if pre(save) ran, but let's recalculate
    if (p.variants && p.variants.length > 0) {
      const prices = p.variants.map(v => v.currentPrice).filter(price => price > 0);
      if (prices.length > 0) {
        min = Math.min(...prices);
        max = Math.max(...prices);
      } else {
        min = basePrice;
        max = basePrice;
      }
    } else {
      // For simple products, priceRange is basePrice
      min = basePrice;
      max = basePrice;
    }
    
    // Fix missing basePrice if variants exist but basePrice missing
    if (p.variants && p.variants.length > 0 && p.basePrice == null) {
      basePrice = min;
    }
    
    await db.collection('products').updateOne({ _id: p._id }, { 
      $set: { 
        'priceRange.min': min, 
        'priceRange.max': max,
        basePrice: basePrice
      } 
    });
  }
  console.log('Successfully updated all products with priceRange.min and basePrice.');
  process.exit(0);
});
