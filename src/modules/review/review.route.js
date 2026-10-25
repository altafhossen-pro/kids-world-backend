const express = require('express');
const router = express.Router();
const reviewController = require('./review.controller');
const verifyToken = require('../../middlewares/verifyToken');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');

// Admin routes (must be defined before /:id)
router.get('/admin/list', verifyTokenAdmin, reviewController.getAdminReviews);
router.post('/admin', verifyTokenAdmin, reviewController.createAdminReview);
router.put('/admin/:id', verifyTokenAdmin, reviewController.updateReview);
router.delete('/admin/:id', verifyTokenAdmin, reviewController.deleteReview);
router.patch('/admin/:id/toggle-status', verifyTokenAdmin, reviewController.toggleReviewStatus);

// Public routes
router.get('/', reviewController.getReviews);
router.post('/public', reviewController.createPublicReview);
router.get('/:id', reviewController.getReviewById);

// Protected user routes
router.post('/', verifyToken, reviewController.createUserReview);
router.get('/user/reviews', verifyToken, reviewController.getUserReviews);
router.get('/user/reviewable-products', verifyToken, reviewController.getUserReviewableProducts);
router.put('/:id', verifyToken, reviewController.updateReview);
router.delete('/:id', verifyToken, reviewController.deleteReview);

module.exports = router;

