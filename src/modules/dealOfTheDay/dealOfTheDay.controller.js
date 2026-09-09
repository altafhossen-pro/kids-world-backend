const DealOfTheDay = require('./dealOfTheDay.model');
const sendResponse = require('../../utils/sendResponse');

// @desc    Get all deals (for admin)
// @route   GET /api/deal-of-the-day
// @access  Private/Admin
const getAllDeals = async (req, res) => {
    try {
        const deals = await DealOfTheDay.find()
            .sort('-createdAt')
            .select('-__v');

        const total = await DealOfTheDay.countDocuments();

        return sendResponse({
            res,
            statusCode: 200,
            success: true,
            message: 'Deals retrieved successfully',
            data: deals,
            meta: {
                total
            }
        });
    } catch (error) {
        return sendResponse({
            res,
            statusCode: 500,
            success: false,
            message: error.message || 'Server error'
        });
    }
};

// @desc    Get active deal
// @route   GET /api/deal-of-the-day/active
// @access  Public
const getActiveDeal = async (req, res) => {
    try {
        const deal = await DealOfTheDay.findOne({ isActive: true }).select('-__v -createdAt -updatedAt');

        return sendResponse({
            res,
            statusCode: 200,
            success: true,
            message: 'Active deal retrieved successfully',
            data: deal
        });
    } catch (error) {
        return sendResponse({
            res,
            statusCode: 500,
            success: false,
            message: error.message || 'Server error'
        });
    }
};

// @desc    Get deal by ID
// @route   GET /api/deal-of-the-day/:id
// @access  Private/Admin
const getDealById = async (req, res) => {
    try {
        const { id } = req.params;
        const deal = await DealOfTheDay.findById(id).select('-__v');

        if (!deal) {
            return sendResponse({
                res,
                statusCode: 404,
                success: false,
                message: 'Deal not found'
            });
        }

        return sendResponse({
            res,
            statusCode: 200,
            success: true,
            message: 'Deal retrieved successfully',
            data: deal
        });
    } catch (error) {
        return sendResponse({
            res,
            statusCode: 500,
            success: false,
            message: error.message || 'Server error'
        });
    }
};

// @desc    Create a deal
// @route   POST /api/deal-of-the-day
// @access  Private/Admin
const createDeal = async (req, res) => {
    try {
        const { title, subtitle, image, endTime, buttonText, buttonLink, isActive } = req.body;

        // Ensure required fields are present
        if (!title || !subtitle || !image || !endTime) {
            return sendResponse({
                res,
                statusCode: 400,
                success: false,
                message: 'Title, subtitle, image, and end time are required'
            });
        }

        const newDeal = new DealOfTheDay({
            title,
            subtitle,
            image,
            endTime,
            buttonText,
            buttonLink,
            isActive
        });

        const savedDeal = await newDeal.save();

        return sendResponse({
            res,
            statusCode: 201,
            success: true,
            message: 'Deal created successfully',
            data: savedDeal
        });
    } catch (error) {
        return sendResponse({
            res,
            statusCode: 500,
            success: false,
            message: error.message || 'Server error'
        });
    }
};

// @desc    Update a deal
// @route   PUT /api/deal-of-the-day/:id
// @access  Private/Admin
const updateDeal = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, subtitle, image, endTime, buttonText, buttonLink, isActive } = req.body;

        const deal = await DealOfTheDay.findById(id);

        if (!deal) {
            return sendResponse({
                res,
                statusCode: 404,
                success: false,
                message: 'Deal not found'
            });
        }

        // If this deal is being set to active, the pre-save hook will handle deactivating others
        if (isActive !== undefined) {
            deal.isActive = isActive;
        }

        if (title) deal.title = title;
        if (subtitle) deal.subtitle = subtitle;
        if (image) deal.image = image;
        if (endTime) deal.endTime = endTime;
        if (buttonText !== undefined) deal.buttonText = buttonText;
        if (buttonLink !== undefined) deal.buttonLink = buttonLink;

        const updatedDeal = await deal.save();

        return sendResponse({
            res,
            statusCode: 200,
            success: true,
            message: 'Deal updated successfully',
            data: updatedDeal
        });
    } catch (error) {
        return sendResponse({
            res,
            statusCode: 500,
            success: false,
            message: error.message || 'Server error'
        });
    }
};

// @desc    Delete a deal
// @route   DELETE /api/deal-of-the-day/:id
// @access  Private/Admin
const deleteDeal = async (req, res) => {
    try {
        const { id } = req.params;
        const deal = await DealOfTheDay.findById(id);

        if (!deal) {
            return sendResponse({
                res,
                statusCode: 404,
                success: false,
                message: 'Deal not found'
            });
        }

        await DealOfTheDay.findByIdAndDelete(id);

        return sendResponse({
            res,
            statusCode: 200,
            success: true,
            message: 'Deal deleted successfully'
        });
    } catch (error) {
        return sendResponse({
            res,
            statusCode: 500,
            success: false,
            message: error.message || 'Server error'
        });
    }
};

// @desc    Toggle deal status
// @route   PATCH /api/deal-of-the-day/:id/toggle-status
// @access  Private/Admin
const toggleStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const deal = await DealOfTheDay.findById(id);

        if (!deal) {
            return sendResponse({
                res,
                statusCode: 404,
                success: false,
                message: 'Deal not found'
            });
        }

        deal.isActive = !deal.isActive;
        const updatedDeal = await deal.save();

        return sendResponse({
            res,
            statusCode: 200,
            success: true,
            message: `Deal ${updatedDeal.isActive ? 'activated' : 'deactivated'} successfully`,
            data: updatedDeal
        });
    } catch (error) {
        return sendResponse({
            res,
            statusCode: 500,
            success: false,
            message: error.message || 'Server error'
        });
    }
};

module.exports = {
    getAllDeals,
    getActiveDeal,
    getDealById,
    createDeal,
    updateDeal,
    deleteDeal,
    toggleStatus
};
