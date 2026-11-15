const mongoose = require('mongoose');

// Visitor Session Model (Tracks daily session, metrics, cart state, and customer identification)
const visitorSessionSchema = new mongoose.Schema({
    visitorId: {
        type: String,
        required: true,
        index: true
    },
    dailySerial: {
        type: Number,
        default: 1,
        index: true
    },
    sessionDate: {
        type: String, // 'YYYY-MM-DD' in Asia/Dhaka
        required: true,
        index: true
    },
    ip: {
        type: String,
        default: '127.0.0.1'
    },
    device: {
        type: String,
        default: 'Desktop' // 'Mobile', 'Desktop', 'Tablet'
    },
    browser: {
        type: String,
        default: 'Unknown'
    },
    os: {
        type: String,
        default: 'Unknown'
    },
    referrer: {
        type: String,
        default: ''
    },
    entryUrl: {
        type: String,
        default: '/'
    },
    lastUrl: {
        type: String,
        default: '/'
    },
    lastTitle: {
        type: String,
        default: 'Storefront'
    },
    pageViewsCount: {
        type: Number,
        default: 1
    },
    durationSeconds: {
        type: Number,
        default: 0
    },
    isReturning: {
        type: Boolean,
        default: false
    },
    hasCart: {
        type: Boolean,
        default: false
    },
    cartItems: [{
        productId: String,
        slug: String,
        title: String,
        image: String,
        price: Number,
        quantity: Number,
        variant: String
    }],
    cartTotal: {
        type: Number,
        default: 0
    },
    visitedCheckout: {
        type: Boolean,
        default: false
    },
    isOrderPlaced: {
        type: Boolean,
        default: false
    },
    placedOrderId: {
        type: String,
        default: null
    },
    placedOrderAmount: {
        type: Number,
        default: 0
    },
    // Pre-order Customer Identification
    customerName: {
        type: String,
        default: null
    },
    customerPhone: {
        type: String,
        default: null,
        index: true
    },
    customerAddress: {
        type: String,
        default: null
    },
    customerNotes: {
        type: String,
        default: null
    },
    deliveryCharge: {
        type: Number,
        default: 0
    },
    checkoutInfoHistory: [{
        name: String,
        phone: String,
        address: String,
        notes: String,
        capturedAt: {
            type: Date,
            default: Date.now
        }
    }],
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    firstSeenAt: {
        type: Date,
        default: Date.now
    },
    lastSeenAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true,
    versionKey: false
});

// Compound index for fast date querying and unique session resolution
visitorSessionSchema.index({ sessionDate: 1, visitorId: 1 }, { unique: true });
visitorSessionSchema.index({ sessionDate: 1, dailySerial: 1 });
visitorSessionSchema.index({ sessionDate: 1, hasCart: 1 });
visitorSessionSchema.index({ sessionDate: 1, visitedCheckout: 1 });

// Visitor Event Model (Granular Chronological Journey Timeline)
const visitorEventSchema = new mongoose.Schema({
    visitorSessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'VisitorSession',
        required: false,
        index: true
    },
    visitorId: {
        type: String,
        required: true,
        index: true
    },
    sessionDate: {
        type: String, // 'YYYY-MM-DD'
        index: true
    },
    eventType: {
        type: String,
        enum: [
            'page_view',
            'product_view',
            'add_to_cart',
            'remove_from_cart',
            'checkout_step',
            'profile_identified',
            'order_placed',
            'offer_sent',
            'offer_accepted',
            'offer_dismissed'
        ],
        required: true
    },
    url: {
        type: String,
        default: '/'
    },
    title: {
        type: String,
        default: 'Page'
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    versionKey: false
});

visitorEventSchema.index({ visitorSessionId: 1, timestamp: 1 });
visitorEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 }); // TTL: 7 days retention for events

const VisitorSession = mongoose.model('VisitorSession', visitorSessionSchema);
const VisitorEvent = mongoose.model('VisitorEvent', visitorEventSchema);

module.exports = {
    VisitorSession,
    VisitorEvent
};
