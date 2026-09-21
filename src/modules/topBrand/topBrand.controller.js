const TopBrand = require('./topBrand.model');

// @desc    Create a new top brand
// @route   POST /api/v1/top-brands
// @access  Private/Admin
const createTopBrand = async (req, res) => {
    try {
        const { image, order, isActive } = req.body;

        if (!image) {
            return res.status(400).json({
                success: false,
                message: 'Image is required'
            });
        }

        const topBrand = await TopBrand.create({
            image,
            order: order || 0,
            isActive: isActive !== undefined ? isActive : true
        });

        res.status(201).json({
            success: true,
            data: topBrand,
            message: 'Top Brand created successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get all top brands
// @route   GET /api/v1/top-brands
// @access  Public
const getTopBrands = async (req, res) => {
    try {
        // Query active only if non-admin/public, but since this is small we can return all or filter in frontend.
        // Let's allow passing ?active=true
        const query = {};
        if (req.query.active === 'true') {
            query.isActive = true;
        }

        const brands = await TopBrand.find(query).sort({ order: 1, createdAt: -1 });

        res.status(200).json({
            success: true,
            data: brands
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Update top brand
// @route   PUT /api/v1/top-brands/:id
// @access  Private/Admin
const updateTopBrand = async (req, res) => {
    try {
        const topBrand = await TopBrand.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!topBrand) {
            return res.status(404).json({
                success: false,
                message: 'Top Brand not found'
            });
        }

        res.status(200).json({
            success: true,
            data: topBrand,
            message: 'Top Brand updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Delete top brand
// @route   DELETE /api/v1/top-brands/:id
// @access  Private/Admin
const deleteTopBrand = async (req, res) => {
    try {
        const topBrand = await TopBrand.findById(req.params.id);

        if (!topBrand) {
            return res.status(404).json({
                success: false,
                message: 'Top Brand not found'
            });
        }

        await topBrand.deleteOne();

        res.status(200).json({
            success: true,
            message: 'Top Brand deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Update top brands order (bulk)
// @route   POST /api/v1/top-brands/reorder
// @access  Private/Admin
const reorderTopBrands = async (req, res) => {
    try {
        const { items } = req.body; // Expect array of { id, order }

        if (!items || !Array.isArray(items)) {
            return res.status(400).json({
                success: false,
                message: 'Items array is required'
            });
        }

        // Use bulk write for efficient updates
        const operations = items.map(item => ({
            updateOne: {
                filter: { _id: item.id },
                update: { $set: { order: item.order } }
            }
        }));

        await TopBrand.bulkWrite(operations);

        res.status(200).json({
            success: true,
            message: 'Order updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

module.exports = {
    createTopBrand,
    getTopBrands,
    updateTopBrand,
    deleteTopBrand,
    reorderTopBrands
};
