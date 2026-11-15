const express = require('express');
const router = express.Router();
const piprapayController = require('./piprapay.controller');
const verifyToken = require('../../middlewares/verifyToken');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');

// Initiate payment for an order
router.post('/initiate/:orderId', piprapayController.initiatePayment);

// Callback endpoint (handles both GET and POST from PipraPay redirect)
router.get('/callback', piprapayController.handleCallback);
router.post('/callback', piprapayController.handleCallback);

// IPN / Webhook endpoint
router.post('/webhook', piprapayController.handleWebhook);

// Admin PipraPay Error Logs (File-based)
router.get('/logs', verifyToken, verifyTokenAdmin, piprapayController.getLogs);
router.put('/logs', verifyToken, verifyTokenAdmin, piprapayController.updateLogs);
router.delete('/logs', verifyToken, verifyTokenAdmin, piprapayController.clearLogs);

module.exports = router;
