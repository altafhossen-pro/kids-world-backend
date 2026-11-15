const mongoose = require('mongoose');

const offerTemplateSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Template name is required'],
            trim: true,
        },
        title: {
            type: String,
            required: [true, 'Headline/Title is required'],
            trim: true,
        },
        message: {
            type: String,
            required: [true, 'Offer message is required'],
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
        isActive: {
            type: Boolean,
            default: true,
        },
        createdByName: {
            type: String,
            default: 'Admin',
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

const OfferTemplate = mongoose.model('OfferTemplate', offerTemplateSchema);

module.exports = OfferTemplate;
