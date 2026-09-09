const express = require('express');
const router = express.Router();
const verifyToken = require('../../middlewares/verifyToken');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');

const {
    getAllDeals,
    getActiveDeal,
    getDealById,
    createDeal,
    updateDeal,
    deleteDeal,
    toggleStatus
} = require('./dealOfTheDay.controller');

// Public route
router.get('/active', getActiveDeal);

// Admin routes
router.get('/', verifyToken, verifyTokenAdmin, getAllDeals);
router.get('/:id', verifyToken, verifyTokenAdmin, getDealById);
router.post('/', verifyToken, verifyTokenAdmin, createDeal);
router.put('/:id', verifyToken, verifyTokenAdmin, updateDeal);
router.delete('/:id', verifyToken, verifyTokenAdmin, deleteDeal);
router.patch('/:id/toggle-status', verifyToken, verifyTokenAdmin, toggleStatus);

module.exports = router;
