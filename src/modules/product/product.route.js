const express = require('express');
const router = express.Router();
const productController = require('./product.controller');
const verifyTokenAdmin = require('../../middlewares/verifyTokenAdmin');
const { checkPermission } = require('../../middlewares/checkPermission');

const cacheMiddleware = require('../../middleware/cacheMiddleware');

// Special product lists
router.get('/featured', cacheMiddleware, productController.getFeaturedProducts);
router.get('/discounted', cacheMiddleware, productController.getDiscountedProducts);
router.get('/new-arrivals', cacheMiddleware, productController.getNewArrivals);
router.get('/bestselling', cacheMiddleware, productController.getBestsellingProducts);
router.get('/trending', cacheMiddleware, productController.getTrendingProducts);
router.get('/random', cacheMiddleware, productController.getRandomProducts);
router.get('/product-videos', cacheMiddleware, productController.getProductVideos);
router.get('/search', cacheMiddleware, productController.searchProducts);
router.get('/filters', cacheMiddleware, productController.getAvailableFilters);
router.get('/similar/:productId', cacheMiddleware, productController.getSimilarProducts);

// Stock checking
router.post('/check-stock', productController.checkStockAvailability);

// Public routes
router.get('/brands', productController.getAllBrands);
router.get('/sitemap-slugs', productController.getProductSlugsForSitemap);
router.get('/', productController.getProducts);
router.get('/slug/:slug', productController.getProductBySlug);
router.get('/:id', productController.getProductById);

// Admin routes with permission checks
// Note: Specific routes (like /admin/list) should come before dynamic routes (like /admin/:id)
router.get('/admin/list', verifyTokenAdmin, checkPermission('product', 'read'), productController.getAdminProducts);
router.get('/admin/next-sku/:categoryId', verifyTokenAdmin, checkPermission('product', 'read'), productController.getNextSkuForCategory);
router.patch('/admin/bulk-exclude-category-discount', verifyTokenAdmin, checkPermission('product', 'update'), productController.bulkExcludeCategoryDiscount);
router.get('/admin/:id', verifyTokenAdmin, checkPermission('product', 'read'), productController.getAdminProductById);
router.post('/', verifyTokenAdmin, checkPermission('product', 'create'), productController.createProduct);
router.patch('/:id', verifyTokenAdmin, checkPermission('product', 'update'), productController.updateProduct);
router.delete('/:id', verifyTokenAdmin, checkPermission('product', 'delete'), productController.deleteProduct);

module.exports = router;
