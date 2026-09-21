const mongoose = require('mongoose');

const topBrandSchema = new mongoose.Schema(
  {
    image: {
      type: String,
      required: [true, 'Brand image is required'],
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const TopBrand = mongoose.model('TopBrand', topBrandSchema);
module.exports = TopBrand;
