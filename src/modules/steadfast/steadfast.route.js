const express = require('express');
const steadfastController = require('./steadfast.controller');
const verifyToken = require('../../middlewares/verifyToken');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');
const router = express.Router();

// Webhook endpoint (public, but auth is validated inside using webhook token)
router.post('/webhook', steadfastController.handleWebhook);

// Check connection and credentials validity (Admin only)
router.get('/check-connection', verifyToken, verifyTokenAdmin, steadfastController.checkConnection);

// Get live merchant account balance (Admin only)
router.get('/balance', verifyToken, verifyTokenAdmin, steadfastController.getBalance);

// Get customer fraud check & courier history by phone (Admin only)
router.get('/fraud-check/:phone', verifyToken, verifyTokenAdmin, steadfastController.getFraudScore);

// Get tracking history (Admin only)
router.get('/tracking/:invoice', verifyToken, verifyTokenAdmin, steadfastController.getTrackingHistory);

// Get live step-by-step courier tracking & financial settlement (Admin only)
router.get('/live-tracking/:invoice', verifyToken, verifyTokenAdmin, steadfastController.getLiveTracking);

// Steadfast Error Logs endpoints (Admin only)
router.get('/logs', verifyToken, verifyTokenAdmin, steadfastController.getLogs);
router.put('/logs', verifyToken, verifyTokenAdmin, steadfastController.updateLogs);
router.delete('/logs', verifyToken, verifyTokenAdmin, steadfastController.clearLogs);

module.exports = router;
