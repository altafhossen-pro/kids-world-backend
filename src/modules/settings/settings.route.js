const express = require('express');
const router = express.Router();
const settingsController = require('./settings.controller');
const verifyToken = require('../../middlewares/verifyToken');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');

const cacheMiddleware = require('../../middleware/cacheMiddleware');

// Get settings (public)
router.get('/', cacheMiddleware, settingsController.getSettings);

// Update settings (Admin only)
router.put('/', verifyToken, verifyTokenAdmin, settingsController.updateSettings);

// Reset settings (Admin only)
router.post('/reset', verifyToken, verifyTokenAdmin, settingsController.resetSettings);

// Loyalty settings endpoints
router.get('/loyalty', cacheMiddleware, settingsController.getLoyaltySettings);
router.put('/loyalty', verifyToken, verifyTokenAdmin, settingsController.updateLoyaltySettings);

// Delivery charge settings endpoints
router.get('/delivery-charge', cacheMiddleware, settingsController.getDeliveryChargeSettings);
router.put('/delivery-charge', verifyToken, verifyTokenAdmin, settingsController.updateDeliveryChargeSettings);

// Email & SMS settings endpoints
router.get('/email-sms', verifyToken, verifyTokenAdmin, settingsController.getEmailSMSSettings);
router.put('/email-sms', verifyToken, verifyTokenAdmin, settingsController.updateEmailSMSSettings);
router.post('/email-sms/test', verifyToken, verifyTokenAdmin, settingsController.testEmailConfig);
router.post('/sms/test', verifyToken, verifyTokenAdmin, settingsController.testSmsConfig);

// Affiliate settings endpoints
router.get('/affiliate', cacheMiddleware, settingsController.getAffiliateSettings);
router.put('/affiliate', verifyToken, verifyTokenAdmin, settingsController.updateAffiliateSettings);

// Steadfast settings endpoints
router.get('/steadfast', verifyToken, verifyTokenAdmin, settingsController.getSteadfastSettings);
router.put('/steadfast', verifyToken, verifyTokenAdmin, settingsController.updateSteadfastSettings);

// Site settings endpoints
router.get('/site-settings', cacheMiddleware, settingsController.getSiteSettings);
router.put('/site-settings', verifyToken, verifyTokenAdmin, settingsController.updateSiteSettings);

// Homepage layout endpoints
router.get('/homepage-layout', cacheMiddleware, settingsController.getHomepageLayoutSettings);
router.put('/homepage-layout', verifyToken, verifyTokenAdmin, settingsController.updateHomepageLayoutSettings);

// Telegram settings endpoints
router.get('/telegram', verifyToken, verifyTokenAdmin, settingsController.getTelegramSettings);
router.put('/telegram', verifyToken, verifyTokenAdmin, settingsController.updateTelegramSettings);
router.post('/telegram/test', verifyToken, verifyTokenAdmin, settingsController.testTelegramConfig);

// Global Product Subtitle endpoints
router.patch('/global-subtitle', verifyToken, verifyTokenAdmin, settingsController.updateGlobalProductSubtitle);

module.exports = router;
