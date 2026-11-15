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
        { totalStock: { $lt: 5 } },
        { 'variants.stockQuantity': { $lt: 5 } }
      ]
    })
      .select('title featuredImage totalStock singleVariant variants')
      .limit(5);

    const lowStockItems = lowStockItemsDb.map((p, idx) => {
      let displayStock = p.singleVariant?.stockQuantity ?? p.totalStock ?? 0;
      if (p.variants && p.variants.length > 0) {
        const lowestVarStock = Math.min(...p.variants.map(v => v.stockQuantity ?? 0));
        displayStock = lowestVarStock;
      }
      return {
        id: p._id.toString() || idx,
        name: p.title || 'Unnamed Product',
        stock: displayStock,
        img: p.featuredImage || '/images/placeholder.png'
      };
    });

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

/**
 * Admin Global Unified Search
 * Searches across:
 * - Product Name, Brand, Product SKU, Variant SKUs -> Links to Product Edit Page
 * - Order ID, Steadfast Consignment ID, Steadfast Tracking Code, Customer Phone -> Links to Order Details
 * - Customers/Users by Name, Phone, Email -> Links to Customer Details & Order History
 */
exports.adminGlobalSearch = async (req, res) => {
  try {
    const rawQ = String(req.query.q || req.query.query || '').trim();
    if (!rawQ || rawQ.length < 2) {
      return sendResponse({
        res,
        statusCode: 200,
        success: true,
        message: 'Search query too short',
        data: { products: [], orders: [], customers: [] }
      });
    }

    const safeRegexStr = rawQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const qRegex = new RegExp(safeRegexStr, 'i');

    const digitsOnly = rawQ.replace(/\D/g, '');
    const phoneTerm = digitsOnly.length >= 3 ? digitsOnly : null;

    // 1. Search Products (by Title, Brand, Variant SKU, SingleVariant SKU)
    const productQuery = {
      $or: [
        { title: qRegex },
        { brand: qRegex },
        { 'variants.sku': qRegex },
        { 'singleVariant.sku': qRegex }
      ]
    };

    const productsPromise = Product.find(productQuery)
      .select('_id title brand featuredImage gallery images productType singleVariant variants basePrice status totalStock')
      .limit(6)
      .lean();

    // 2. Search Orders (by OrderId, Steadfast CID, Tracking Code, Customer Name & Phone)
    const orderConditions = [
      { orderId: qRegex },
      { steadfastConsignmentId: qRegex },
      { steadfastTrackingCode: qRegex },
      { 'shippingAddress.name': qRegex },
      { 'guestInfo.name': qRegex },
      { 'manualOrderInfo.name': qRegex }
    ];

    if (phoneTerm) {
      orderConditions.push({ 'shippingAddress.phone': { $regex: phoneTerm, $options: 'i' } });
      orderConditions.push({ 'guestInfo.phone': { $regex: phoneTerm, $options: 'i' } });
      orderConditions.push({ 'manualOrderInfo.phone': { $regex: phoneTerm, $options: 'i' } });
    }

    if (/^[0-9a-fA-F]{24}$/.test(rawQ)) {
      orderConditions.push({ _id: rawQ });
    }

    const ordersPromise = Order.find({ $or: orderConditions, isDeleted: false })
      .select('_id orderId status paymentStatus total totalAmount shippingCost steadfastConsignmentId steadfastTrackingCode shippingAddress guestInfo manualOrderInfo user createdAt')
      .populate('user', 'name phone email')
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    // 3. Search Customers / Users (by Name, Phone, Email)
    const userConditions = [
      { name: qRegex },
      { email: qRegex }
    ];
    if (phoneTerm) {
      userConditions.push({ phone: { $regex: phoneTerm, $options: 'i' } });
      userConditions.push({ phoneNumber: { $regex: phoneTerm, $options: 'i' } });
    }

    const usersPromise = User.find({ $or: userConditions })
      .select('_id name phone phoneNumber email avatar role createdAt')
      .limit(6)
      .lean();

    const [productsRaw, ordersRaw, usersRaw] = await Promise.all([
      productsPromise,
      ordersPromise,
      usersPromise
    ]);

    // Format Products
    const products = productsRaw.map(p => {
      let matchedSku = p.singleVariant?.sku || '';
      let variantLabel = '';
      if (p.variants && p.variants.length > 0) {
        const foundVar = p.variants.find(v => v.sku && v.sku.toLowerCase().includes(rawQ.toLowerCase()));
        if (foundVar) {
          matchedSku = foundVar.sku;
          const attrStr = (foundVar.attributes || []).map(a => a.value).filter(Boolean).join(' / ');
          if (attrStr) variantLabel = attrStr;
        } else if (!matchedSku && p.variants[0]?.sku) {
          matchedSku = p.variants[0].sku;
        }
      }

      const price = p.singleVariant?.currentPrice || p.basePrice || p.variants?.[0]?.currentPrice || 0;
      const img = p.featuredImage || p.gallery?.[0]?.url || p.images?.[0]?.url || (typeof p.images?.[0] === 'string' ? p.images[0] : null) || '/images/placeholder.png';

      return {
        _id: p._id,
        name: p.title || 'Product',
        sku: matchedSku,
        variantLabel,
        brand: p.brand || '',
        price,
        image: img,
        status: p.status || 'published',
        url: `/admin/dashboard/products/${p._id}/edit`
      };
    });

    // Format Orders
    const orders = ordersRaw.map(o => {
      const customerName = o.shippingAddress?.name || o.guestInfo?.name || o.manualOrderInfo?.name || o.user?.name || 'Customer';
      const customerPhone = o.shippingAddress?.phone || o.guestInfo?.phone || o.manualOrderInfo?.phone || o.user?.phone || '';
      const total = o.total !== undefined ? o.total : (o.totalAmount || 0);

      let matchReason = 'Order';
      if (o.orderId && o.orderId.toLowerCase().includes(rawQ.toLowerCase())) matchReason = `Order #${o.orderId}`;
      else if (o.steadfastConsignmentId && o.steadfastConsignmentId.includes(rawQ)) matchReason = `CID: #${o.steadfastConsignmentId}`;
      else if (o.steadfastTrackingCode && o.steadfastTrackingCode.toLowerCase().includes(rawQ.toLowerCase())) matchReason = `Track: ${o.steadfastTrackingCode}`;
      else if (customerPhone && phoneTerm && customerPhone.includes(phoneTerm)) matchReason = `Phone: ${customerPhone}`;

      return {
        _id: o._id,
        orderId: o.orderId,
        customerName,
        customerPhone,
        total,
        status: o.status,
        paymentStatus: o.paymentStatus,
        steadfastConsignmentId: o.steadfastConsignmentId || null,
        steadfastTrackingCode: o.steadfastTrackingCode || null,
        matchReason,
        createdAt: o.createdAt,
        url: `/admin/dashboard/orders/${o._id}`
      };
    });

    // Format Customers
    const customers = usersRaw.map(u => ({
      _id: u._id,
      name: u.name || 'Customer',
      phone: u.phone || u.phoneNumber || '',
      email: u.email || '',
      role: u.role || 'customer',
      avatar: u.avatar || null,
      url: `/admin/dashboard/customers/${u._id}`,
      orderHistoryUrl: (u.phone || u.phoneNumber) ? `/admin/dashboard/order-history/${u.phone || u.phoneNumber}` : `/admin/dashboard/customers/${u._id}`
    }));

    // If phoneTerm is searched and not found in users, also check if guest orders exist for this phone
    if (phoneTerm && phoneTerm.length >= 6) {
      const guestOrder = await Order.findOne({
        $or: [
          { 'shippingAddress.phone': { $regex: phoneTerm, $options: 'i' } },
          { 'guestInfo.phone': { $regex: phoneTerm, $options: 'i' } },
          { 'manualOrderInfo.phone': { $regex: phoneTerm, $options: 'i' } }
        ]
      }).select('shippingAddress guestInfo manualOrderInfo').lean();

      if (guestOrder) {
        const gPhone = guestOrder.shippingAddress?.phone || guestOrder.guestInfo?.phone || guestOrder.manualOrderInfo?.phone;
        const gName = guestOrder.shippingAddress?.name || guestOrder.guestInfo?.name || guestOrder.manualOrderInfo?.name || 'Guest Customer';
        const alreadyIncluded = customers.some(c => c.phone && c.phone.includes(phoneTerm));
        if (!alreadyIncluded && gPhone) {
          customers.push({
            _id: `guest_${gPhone}`,
            name: gName,
            phone: gPhone,
            email: '',
            role: 'Guest Customer',
            isGuest: true,
            url: `/admin/dashboard/order-history/${gPhone}`,
            orderHistoryUrl: `/admin/dashboard/order-history/${gPhone}`
          });
        }
      }
    }

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Search completed successfully',
      data: {
        products,
        orders,
        customers
      }
    });

  } catch (error) {
    console.error('Admin Search Error:', error);
    return sendResponse({
      res,
      statusCode: 500,
      success: false,
      message: error.message || 'Server error during search'
    });
  }
};
