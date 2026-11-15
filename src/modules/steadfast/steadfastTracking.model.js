const mongoose = require('mongoose');

const steadfastTrackingSchema = new mongoose.Schema(
  {
    notification_type: {
      type: String,
      default: 'delivery_status',
    },
    consignment_id: {
      type: Number,
      required: true,
      index: true,
    },
    invoice: {
      type: String,
      index: true,
    },
    status: {
      type: String,
    },
    tracking_message: {
      type: String,
      default: '',
    },
    cod_amount: {
      type: Number,
    },
    delivery_charge: {
      type: Number,
    },
    cod_charge: {
      type: Number,
    },
    net_amount: {
      type: Number,
    },
    source: {
      type: String,
      default: 'webhook',
    },
    updated_at_steadfast: {
      type: Date,
    },
    raw_payload: {
      type: Object, // Store the raw payload just in case we need extra fields later
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt for our own db
  }
);

module.exports = mongoose.model('SteadfastTracking', steadfastTrackingSchema);
