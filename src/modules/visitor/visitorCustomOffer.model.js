const mongoose = require('mongoose');

const visitorCustomOfferSchema = new mongoose.Schema(
    {
        visitorId: {
            type: String,
            required: true,
            index: true,
            trim: true,
        },
        customerPhone: {
            type: String,
            index: true,
            trim: true,
            default: null,
        },
        customerName: {
            type: String,
            default: null,
            trim: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        message: {
            type: String,
            required: true,
            trim: true,
        },
        buttonText: {
            type: String,
            default: 'অর্ডার সম্পন্ন করুন',
            trim: true,
        },
        buttonUrl: {
            type: String,
            default: '/checkout',
            trim: true,
        },
        delaySeconds: {
            type: Number,
            default: 0,
            min: 0,
            max: 300,
        },
        status: {
            type: String,
            enum: ['pending', 'delivered', 'clicked', 'dismissed'],
            default: 'pending',
            index: true,
        },
        adminName: {
            type: String,
            default: 'Admin',
        },
        templateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'OfferTemplate',
            default: null,
        },
        deliveredAt: {
            type: Date,
            default: null,
        },
        actionAt: {
            type: Date,
            default: null,
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days retention
            index: { expires: 0 },
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

visitorCustomOfferSchema.index({ visitorId: 1, status: 1, createdAt: -1 });

const VisitorCustomOffer = mongoose.model('VisitorCustomOffer', visitorCustomOfferSchema);

module.exports = VisitorCustomOffer;
