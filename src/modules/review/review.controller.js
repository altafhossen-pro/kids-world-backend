const { Review } = require('./review.model');
const { Product } = require('../product/product.model');
const sendResponse = require('../../utils/sendResponse');

// Admin: Get all reviews with pagination, search, and filters
exports.getAdminReviews = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { search, isApproved, rating, productId } = req.query;

    let filter = {};

    if (productId) {
      filter.product = productId;
    }

    if (isApproved !== undefined && isApproved !== '' && isApproved !== 'all') {
      filter.isApproved = isApproved === 'true';
    }

    if (rating && rating !== 'all') {
      filter.rating = Number(rating);
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { customerName: searchRegex },
        { customerEmail: searchRegex },
        { comment: searchRegex },
        { title: searchRegex }
      ];
    }

    const total = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .populate('product', 'title featuredImage slug priceRange basePrice')
      .populate('user', 'name email avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Summary stats
    const totalReviews = await Review.countDocuments({});
    const approvedReviews = await Review.countDocuments({ isApproved: true });
    const pendingReviews = await Review.countDocuments({ isApproved: false });

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Admin reviews fetched successfully',
      data: reviews,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      },
      stats: {
        totalReviews,
        approvedReviews,
        pendingReviews
      }
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

// Admin: Create manual or customer review
exports.createAdminReview = async (req, res) => {
  try {
    const { productId, customerName, customerEmail, rating, title, comment, isApproved, isVerifiedPurchase, images } = req.body;

    if (!productId) {
      return sendResponse({ res, statusCode: 400, success: false, message: 'Product is required' });
    }

    if (!rating || rating < 1 || rating > 5) {
      return sendResponse({ res, statusCode: 400, success: false, message: 'Valid rating between 1 and 5 is required' });
    }

    if (!comment || !comment.trim()) {
      return sendResponse({ res, statusCode: 400, success: false, message: 'Review comment is required' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return sendResponse({ res, statusCode: 404, success: false, message: 'Product not found' });
    }

    const review = new Review({
      product: productId,
      customerName: (customerName || 'Verified Buyer').trim(),
      customerEmail: (customerEmail || '').trim(),
      rating: Number(rating),
      title: title ? title.trim() : '',
      comment: comment.trim(),
      images: images || [],
      isVerifiedPurchase: isVerifiedPurchase !== undefined ? Boolean(isVerifiedPurchase) : true,
      isApproved: isApproved !== undefined ? Boolean(isApproved) : true,
      user: req.user?._id || undefined
    });

    await review.save();
    await updateProductRating(productId);

    const populated = await Review.findById(review._id).populate('product', 'title featuredImage slug');

    return sendResponse({
      res,
      statusCode: 201,
      success: true,
      message: 'Review created successfully',
      data: populated
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

// Public: Get approved reviews for a product
exports.getReviews = async (req, res) => {
  try {
    const filter = { isApproved: true };
    if (req.query.product) {
      filter.product = req.query.product;
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const total = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .populate('user', 'name avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Reviews fetched',
      data: reviews,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

exports.getReviewById = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('product', 'title featuredImage slug')
      .populate('user', 'name email avatar');
    if (!review) return sendResponse({ res, statusCode: 404, success: false, message: 'Review not found' });
    return sendResponse({ res, statusCode: 200, success: true, message: 'Review fetched', data: review });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

// Admin: Update review
exports.updateReview = async (req, res) => {
  try {
    const { rating, comment, customerName, customerEmail, title, isApproved, isVerifiedPurchase, images, productId } = req.body;
    const review = await Review.findById(req.params.id);
    if (!review) return sendResponse({ res, statusCode: 404, success: false, message: 'Review not found' });

    const oldProductId = review.product;

    if (productId && productId !== review.product.toString()) {
      review.product = productId;
    }
    if (rating !== undefined) review.rating = Number(rating);
    if (comment !== undefined) review.comment = comment.trim();
    if (customerName !== undefined) review.customerName = customerName.trim();
    if (customerEmail !== undefined) review.customerEmail = customerEmail.trim();
    if (title !== undefined) review.title = title.trim();
    if (isApproved !== undefined) review.isApproved = Boolean(isApproved);
    if (isVerifiedPurchase !== undefined) review.isVerifiedPurchase = Boolean(isVerifiedPurchase);
    if (images !== undefined) review.images = images;

    await review.save();

    await updateProductRating(review.product);
    if (oldProductId && oldProductId.toString() !== review.product.toString()) {
      await updateProductRating(oldProductId);
    }

    const updated = await Review.findById(review._id).populate('product', 'title featuredImage slug');

    return sendResponse({ res, statusCode: 200, success: true, message: 'Review updated successfully', data: updated });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

// Admin: Toggle approval status
exports.toggleReviewStatus = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return sendResponse({ res, statusCode: 404, success: false, message: 'Review not found' });

    review.isApproved = !review.isApproved;
    await review.save();
    await updateProductRating(review.product);

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: `Review ${review.isApproved ? 'approved' : 'hidden'} successfully`,
      data: review
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

// Admin: Delete review
exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) return sendResponse({ res, statusCode: 404, success: false, message: 'Review not found' });
    await updateProductRating(review.product);
    return sendResponse({ res, statusCode: 200, success: true, message: 'Review deleted successfully' });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};


// Get user's reviews
exports.getUserReviews = async (req, res) => {
  try {
    const userId = req.user._id;
    const reviews = await Review.find({ user: userId })
      .populate('product', 'title featuredImage slug')
      .sort({ createdAt: -1 });
    return sendResponse({ res, statusCode: 200, success: true, message: 'User reviews fetched', data: reviews });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

// Get user's reviewable products (from delivered orders)
exports.getUserReviewableProducts = async (req, res) => {
  try {
    const userId = req.user._id;
    const { Order } = require('../order/order.model');

    // Get all delivered orders for the user
    const deliveredOrders = await Order.find({
      user: userId,
      status: 'delivered'
    }).populate('items.product', 'title featuredImage slug');

    // Extract unique products that can be reviewed
    const reviewableProducts = [];
    const reviewedProductIds = new Set();

    // Get already reviewed products
    const existingReviews = await Review.find({ user: userId }).select('product');
    existingReviews.forEach(review => reviewedProductIds.add(review.product.toString()));

    // Process each order's items
    deliveredOrders.forEach(order => {
      order.items.forEach(item => {
        const productId = item.product._id.toString();

        // Check if product is not already reviewed
        if (!reviewedProductIds.has(productId)) {
          // Check if this product is not already in reviewableProducts
          const exists = reviewableProducts.some(p => p.product._id.toString() === productId);
          if (!exists) {
            reviewableProducts.push({
              product: item.product,
              orderId: order.orderId,
              orderDate: order.createdAt,
              variant: item.variant,
              quantity: item.quantity,
              price: item.price
            });
          }
        }
      });
    });

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Reviewable products fetched',
      data: reviewableProducts
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

// Create review with verification
exports.createUserReview = async (req, res) => {
  try {
    const userId = req.user._id;

    if (!req.body) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'Request body is missing'
      });
    }

    const { productId, rating, comment, images } = req.body;

    // Validate required fields
    if (!productId) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'Product ID is required'
      });
    }

    if (!rating || rating < 1 || rating > 5) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'Valid rating (1-5) is required'
      });
    }

    if (!comment || comment.trim().length === 0) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'Review comment is required'
      });
    }

    // Verify that user has purchased this product (from delivered orders)
    const { Order } = require('../order/order.model');
    const hasPurchased = await Order.findOne({
      user: userId,
      status: 'delivered',
      'items.product': productId
    });

    if (!hasPurchased) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'You can only review products you have purchased and received'
      });
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({ user: userId, product: productId });
    if (existingReview) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'You have already reviewed this product'
      });
    }

    const review = new Review({
      product: productId,
      user: userId,
      rating,
      comment,
      images: images || [],
      isVerifiedPurchase: true
    });

    await review.save();
    await updateProductRating(productId);

    return sendResponse({
      res,
      statusCode: 201,
      success: true,
      message: 'Review created successfully',
      data: review
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

// Public: Submit a review from product page
exports.createPublicReview = async (req, res) => {
  try {
    const { productId, rating, comment, customerName, customerEmail, title } = req.body;

    if (!productId) {
      return sendResponse({ res, statusCode: 400, success: false, message: 'Product is required' });
    }
    if (!rating || rating < 1 || rating > 5) {
      return sendResponse({ res, statusCode: 400, success: false, message: 'Valid rating between 1 and 5 is required' });
    }
    if (!comment || !comment.trim()) {
      return sendResponse({ res, statusCode: 400, success: false, message: 'Review comment is required' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return sendResponse({ res, statusCode: 404, success: false, message: 'Product not found' });
    }

    const review = new Review({
      product: productId,
      customerName: (customerName || 'Verified Customer').trim(),
      customerEmail: (customerEmail || '').trim(),
      rating: Number(rating),
      title: title ? title.trim() : '',
      comment: comment.trim(),
      isApproved: true,
      isVerifiedPurchase: false,
      user: req.user?._id || undefined
    });

    await review.save();
    await updateProductRating(productId);

    return sendResponse({
      res,
      statusCode: 201,
      success: true,
      message: 'Review submitted successfully! Thank you for your feedback.',
      data: review
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, success: false, message: error.message });
  }
};

async function updateProductRating(productId) {
  if (!productId) return;
  try {
    const reviews = await Review.find({ product: productId, isApproved: true });
    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1))
      : 0;

    const ratingBreakdown = {
      five: reviews.filter(r => r.rating === 5).length,
      four: reviews.filter(r => r.rating === 4).length,
      three: reviews.filter(r => r.rating === 3).length,
      two: reviews.filter(r => r.rating === 2).length,
      one: reviews.filter(r => r.rating === 1).length,
    };

    await Product.findByIdAndUpdate(productId, {
      averageRating,
      totalReviews,
      ratingBreakdown,
    });
  } catch (err) {
    console.error('Error updating product rating:', err);
  }
}

