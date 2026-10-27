const express = require('express');
const router = express.Router();
const metaPixelController = require('./metaPixel.controller');
const verifyToken = require('../../middlewares/verifyToken');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');

// Public route for storefront pixel initialization
router.get('/public', metaPixelController.getPublicSettings);

// Public route for tracking CAPI events from storefront
router.post('/track', metaPixelController.trackServerEvent);

// Admin routes
router.get('/admin', verifyToken, verifyTokenAdmin, metaPixelController.getAdminSettings);
router.put('/', verifyToken, verifyTokenAdmin, metaPixelController.updateSettings);
router.post('/test-event', verifyToken, verifyTokenAdmin, metaPixelController.sendTestEvent);

module.exports = router;
