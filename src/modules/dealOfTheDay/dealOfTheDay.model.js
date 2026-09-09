const mongoose = require('mongoose');

const dealOfTheDaySchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    subtitle: {
        type: String,
        required: [true, 'Subtitle is required'],
        trim: true,
        maxlength: [200, 'Subtitle cannot exceed 200 characters']
    },
    image: {
        type: String,
        required: [true, 'Image is required']
    },
    endTime: {
        type: Date,
        required: [true, 'End time is required']
    },
    buttonText: {
        type: String,
        trim: true,
        maxlength: [50, 'Button text cannot exceed 50 characters'],
        default: 'Shop Deal Now'
    },
    buttonLink: {
        type: String,
        trim: true,
        default: '#'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for active deals
dealOfTheDaySchema.index({ isActive: 1 });

// Ensure only one active deal at a time
dealOfTheDaySchema.pre('save', async function(next) {
    if (this.isActive) {
        // Deactivate all other deals
        await this.constructor.updateMany(
            { _id: { $ne: this._id }, isActive: true },
            { isActive: false }
        );
    }
    next();
});

module.exports = mongoose.model('DealOfTheDay', dealOfTheDaySchema);
