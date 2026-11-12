const mongoose = require('mongoose');

const customerScoreCacheSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    scoreData: {
      type: Object,
      required: true,
    },
    lastFetchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// MongoDB Native TTL Index: 
// Automatically deletes documents after 24 hours (86400 seconds) from lastFetchedAt
customerScoreCacheSchema.index({ lastFetchedAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('CustomerScoreCache', customerScoreCacheSchema);

