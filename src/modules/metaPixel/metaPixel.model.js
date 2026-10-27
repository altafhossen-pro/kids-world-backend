const mongoose = require('mongoose');

const metaPixelSchema = new mongoose.Schema(
  {
    isEnabled: {
      type: Boolean,
      default: false
    },
    pixelCode: {
      type: String,
      default: '',
      trim: true
    },
    pixelId: {
      type: String,
      default: '',
      trim: true
    },
    conversionsApiToken: {
      type: String,
      default: '',
      trim: true
    },
    testEventCode: {
      type: String,
      default: '',
      trim: true
    },
    trackedEvents: {
      pageView: { type: Boolean, default: true },
      viewCategory: { type: Boolean, default: true },
      viewContent: { type: Boolean, default: true },
      search: { type: Boolean, default: true },
      addToCart: { type: Boolean, default: true },
      initiateCheckout: { type: Boolean, default: true },
      completeRegistration: { type: Boolean, default: true },
      contact: { type: Boolean, default: true },
      purchase: { type: Boolean, default: true }
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

const MetaPixel = mongoose.model('MetaPixel', metaPixelSchema);

module.exports = MetaPixel;
