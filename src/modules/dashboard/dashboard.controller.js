const { Order } = require('../order/order.model');
const { Product } = require('../product/product.model');
const { User } = require('../user/user.model');
const { Category } = require('../category/category.model');
const sendResponse = require('../../utils/sendResponse');

exports.getDashboardSummary = async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // 1. Stat Cards
    const totalSalesAggr = await Order.aggregate([
      { $match: { isDeleted: false, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: { $subtract: ['$total', { $ifNull: ['$shippingCost', 0] }] } } } }
    ]);
    const totalSales = totalSalesAggr.length ? totalSalesAggr[0].total : 0;

    const totalOrders = await Order.countDocuments({ isDeleted: false });
    const totalCustomers = await User.countDocuments({ role: 'customer' });
    const totalProducts = await Product.countDocuments();

    // Calculate this week vs last week for sales
    const salesThisWeekAggr = await Order.aggregate([
      { $match: { isDeleted: false, status: { $ne: 'cancelled' }, createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: null, total: { $sum: { $subtract: ['$total', { $ifNull: ['$shippingCost', 0] }] } } } }
    ]);
    const salesThisWeek = salesThisWeekAggr.length ? salesThisWeekAggr[0].total : 0;

    const salesLastWeekAggr = await Order.aggregate([
      { $match: { isDeleted: false, status: { $ne: 'cancelled' }, createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } } },
      { $group: { _id: null, total: { $sum: { $subtract: ['$total', { $ifNull: ['$shippingCost', 0] }] } } } }
    ]);
    const salesLastWeek = salesLastWeekAggr.length ? salesLastWeekAggr[0].total : 0;

    const salesChange = salesLastWeek === 0 ? 100 : ((salesThisWeek - salesLastWeek) / salesLastWeek) * 100;

    // 2. Sales Chart Data (Last 7 Days vs Previous 7 Days)
    const salesChartAggrThisWeek = await Order.aggregate([
      { $match: { isDeleted: false, status: { $ne: 'cancelled' }, createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: { $subtract: ['$total', { $ifNull: ['$shippingCost', 0] }] } }
        }
      }
    ]);

    const salesChartAggrLastWeek = await Order.aggregate([
      { $match: { isDeleted: false, status: { $ne: 'cancelled' }, createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: { $subtract: ['$total', { $ifNull: ['$shippingCost', 0] }] } }
        }
      }
    ]);

    // Format salesChartData to match frontend
    const salesChartData = [];
    for (let i = 6; i >= 0; i--) {
      const dThisWeek = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStrThisWeek = dThisWeek.toISOString().split('T')[0];
      const matchThisWeek = salesChartAggrThisWeek.find(s => s._id === dateStrThisWeek);
      
      const dLastWeek = new Date(dThisWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
      const dateStrLastWeek = dLastWeek.toISOString().split('T')[0];
      const matchLastWeek = salesChartAggrLastWeek.find(s => s._id === dateStrLastWeek);
      
      const shortDate = dThisWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      salesChartData.push({
        date: shortDate,
        thisWeek: matchThisWeek ? matchThisWeek.total : 0,
        lastWeek: matchLastWeek ? matchLastWeek.total : 0
      });
    }

    // 3. Category Data (Sales by Category)
    const categorySalesAggr = await Order.aggregate([
      { $match: { isDeleted: false, status: { $ne: 'cancelled' } } },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "productDoc"
        }
      },
      { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: "$productDoc.category",
          totalSales: { $sum: "$items.subtotal" }
        }
      },
      { $sort: { totalSales: -1 } },
      { $limit: 5 }
    ]);
    
    await Category.populate(categorySalesAggr, { path: '_id', select: 'name' });
    
    const colors = ['#6366F1', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
    const totalCatSales = categorySalesAggr.reduce((acc, curr) => acc + curr.totalSales, 0);
    const categoryData = categorySalesAggr.map((cat, idx) => ({
      name: cat._id?.name || 'Uncategorized',
      value: cat.totalSales,
      color: colors[idx % colors.length],
      pct: totalCatSales > 0 ? ((cat.totalSales / totalCatSales) * 100).toFixed(1) + '%' : '0%'
    }));

    // 4. Recent Orders
    const recentOrdersDb = await Order.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('orderId createdAt status total items')
      .populate('items.product', 'featuredImage image');

    const recentOrders = recentOrdersDb.map(o => {
      const firstItem = o.items[0];
      const img = firstItem?.image || firstItem?.product?.featuredImage || '/images/placeholder.png';
      return {
        id: o.orderId || o._id.toString(),
        time: o.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        status: o.status.charAt(0).toUpperCase() + o.status.slice(1),
        amount: o.total,
        img
      };
    });

    // 5. Top Products (Approximation: best sellers by looking at total sales count if available, else recent products)
    const topProductsAggr = await Order.aggregate([
      { $match: { isDeleted: false, status: { $ne: 'cancelled' } } },
      { $unwind: "$items" },
      { $group: { 
          _id: "$items.product", 
          sold: { $sum: "$items.quantity" },
          revenue: { $sum: "$items.subtotal" }
      }},
      { $sort: { sold: -1 } },
      { $limit: 4 }
    ]);

    await Product.populate(topProductsAggr, { path: '_id', select: 'title featuredImage' });
    const topProducts = topProductsAggr.map((p, idx) => ({
      rank: idx + 1,
      name: p._id?.title || 'Unknown Product',
      sold: p.sold,
      revenue: p.revenue,
      img: p._id?.featuredImage || '/images/placeholder.png'
    }));

    // 6. Low Stock Alert
    const lowStockItemsDb = await Product.find({
      $or: [
        { productType: 'simple', 'singleVariant.stockQuantity': { $lt: 5 } },
        { totalStock: { $lt: 5 } }
      ]
    })
      .select('title featuredImage totalStock singleVariant')
      .limit(5);

    const lowStockItems = lowStockItemsDb.map((p, idx) => ({
      id: p._id.toString() || idx,
      name: p.title || 'Unnamed Product',
      stock: p.singleVariant?.stockQuantity ?? p.totalStock,
      img: p.featuredImage || '/images/placeholder.png'
    }));

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Dashboard summary fetched successfully',
      data: {
        stats: {
          totalSales,
          totalOrders,
          totalCustomers,
          totalProducts,
          salesChange: (salesChange > 0 ? '+' : '') + salesChange.toFixed(1) + '%'
        },
        salesChartData,
        categoryData,
        recentOrders,
        topProducts,
        lowStockItems
      }
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    return sendResponse({
      res,
      statusCode: 500,
      success: false,
      message: error.message || 'Server error',
    });
  }
};
