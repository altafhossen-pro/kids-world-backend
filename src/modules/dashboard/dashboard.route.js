const express = require('express');
const router = express.Router();
const dashboardController = require('./dashboard.controller');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');

router.get('/summary', verifyTokenAdmin, dashboardController.getDashboardSummary);
router.get('/search', verifyTokenAdmin, dashboardController.adminGlobalSearch);

module.exports = router;
