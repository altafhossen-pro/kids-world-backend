const express = require('express');
const router = express.Router();
const visitorController = require('./visitor.controller');
const verifyToken = require('../../middlewares/verifyToken');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');

// Public tracking & offer interaction endpoints (called by client tracker)
router.post('/activity', visitorController.recordActivity);
router.post('/identify', visitorController.identifyCustomer);
router.get('/offers/pending/:visitorId', visitorController.getPendingOffer);
router.post('/offers/:id/action', visitorController.recordOfferAction);

// Admin Analytics & Footprint endpoints
router.get('/footprint', verifyToken, verifyTokenAdmin, visitorController.getFootprint);
router.get('/session/:id/journey', verifyToken, verifyTokenAdmin, visitorController.getSessionJourney);
router.get('/live', verifyToken, verifyTokenAdmin, visitorController.getLiveShoppers);

// Admin Custom Offer & Template endpoints
router.get('/offer-templates', verifyToken, verifyTokenAdmin, visitorController.getOfferTemplates);
router.post('/offer-templates', verifyToken, verifyTokenAdmin, visitorController.createOfferTemplate);
router.put('/offer-templates/:id', verifyToken, verifyTokenAdmin, visitorController.updateOfferTemplate);
router.delete('/offer-templates/:id', verifyToken, verifyTokenAdmin, visitorController.deleteOfferTemplate);
router.post('/offers/send', verifyToken, verifyTokenAdmin, visitorController.sendCustomOffer);
router.get('/offers/history', verifyToken, verifyTokenAdmin, visitorController.getOffersHistory);

module.exports = router;
