const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load env vars
dotenv.config({ path: './.env' });

// Define TopBrand Schema manually for script
const topBrandSchema = new mongoose.Schema({
  image: String,
  order: Number,
  isActive: Boolean
});
const TopBrand = mongoose.model('TopBrand', topBrandSchema);

const dummyBrands = [
  { image: 'https://upload.wikimedia.org/wikipedia/commons/2/20/Adidas_Logo.svg', order: 0, isActive: true },
  { image: 'https://upload.wikimedia.org/wikipedia/commons/a/a6/Logo_NIKE.svg', order: 1, isActive: true },
  { image: 'https://upload.wikimedia.org/wikipedia/commons/2/24/Samsung_Logo.svg', order: 2, isActive: true },
  { image: 'https://upload.wikimedia.org/wikipedia/commons/b/b8/Sony_logo.svg', order: 3, isActive: true },
  { image: 'https://upload.wikimedia.org/wikipedia/commons/b/b5/IKEA_logo.svg', order: 4, isActive: true },
  { image: 'https://upload.wikimedia.org/wikipedia/commons/5/53/H%26M-Logo.svg', order: 5, isActive: true },
  { image: 'https://upload.wikimedia.org/wikipedia/commons/3/30/The_Lego_Group_logo.svg', order: 6, isActive: true },
  { image: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Apple-logo.png', order: 7, isActive: true },
];

const seedBrands = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/kids_world';
    console.log(`Connecting to MongoDB at ${mongoUri}...`);
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected');

    // Clear existing
    await TopBrand.deleteMany({});
    console.log('Cleared existing TopBrands');

    // Insert dummy data
    await TopBrand.insertMany(dummyBrands);
    console.log('Successfully seeded dummy Top Brands');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding Top Brands:', error);
    process.exit(1);
  }
};

seedBrands();
