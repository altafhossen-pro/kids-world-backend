const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  customerName: { type: String, trim: true },
  customerEmail: { type: String, trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String, trim: true },
  comment: { type: String, required: true, trim: true },
  images: [String],
  isVerifiedPurchase: { type: Boolean, default: true },
  helpfulCount: { type: Number, default: 0 },
  isApproved: { type: Boolean, default: true },
}, { timestamps: true });

reviewSchema.index({ product: 1, isApproved: 1, createdAt: -1 });

const Review = mongoose.model('Review', reviewSchema);
module.exports = { Review };

