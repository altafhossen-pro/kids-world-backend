const express = require('express');
const router = express.Router();
const {
    createTopBrand,
    getTopBrands,
    updateTopBrand,
    deleteTopBrand,
    reorderTopBrands
} = require('./topBrand.controller');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');
const { checkPermission } = require('../../middlewares/checkPermission');

router.route('/')
    .get(getTopBrands)
    .post(verifyTokenAdmin, checkPermission('banner', 'create'), createTopBrand);

router.route('/reorder')
    .post(verifyTokenAdmin, checkPermission('banner', 'update'), reorderTopBrands);

router.route('/:id')
    .put(verifyTokenAdmin, checkPermission('banner', 'update'), updateTopBrand)
    .delete(verifyTokenAdmin, checkPermission('banner', 'delete'), deleteTopBrand);

module.exports = router;
