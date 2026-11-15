const fs = require('fs');
const path = require('path');
const Settings = require('../settings/settings.model');
const { Order } = require('../order/order.model');
const SteadfastTracking = require('./steadfastTracking.model');
const mongoose = require('mongoose');
const { logSteadfastError } = require('./steadfast.logger');
const steadfastService = require('./steadfast.service');
const CustomerScoreCache = require('./customerScoreCache.model');

// Helper for file logging
const logSteadfastWebhook = (message) => {
  try {
    const logDir = path.join(__dirname, '../../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'steadfast_webhook.log');
    const logEntry = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(logFile, logEntry);
  } catch (err) {
    console.error('Error writing to steadfast webhook log:', err);
  }
};

// Helper for Telegram
const sendTelegramAlert = async (settings, message) => {
  try {
    if (!settings || !settings.telegramSettings) return;
    const { botToken, chatId } = settings.telegramSettings;
    if (!botToken || !chatId) return;

    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('Error sending telegram alert:', err);
  }
};

// Helper for calculating Steadfast financial payout / receivable settlement
const calculatePayout = (codAmount, deliveryCharge) => {
  const cod = Math.max(0, Math.round(Number(codAmount) || 0));
  const delivery = Math.max(0, Math.round(Number(deliveryCharge) || 0));

  if (cod <= 0) {
    return {
      cod_amount: 0,
      delivery_charge: delivery,
      cod_charge: 0,
      net_receivable: 0
    };
  }

  const diff = cod - delivery;
  if (diff <= 0) {
    return {
      cod_amount: cod,
      delivery_charge: delivery,
      cod_charge: 0,
      net_receivable: 0
    };
  }

  const codCharge = Math.round(diff * 0.01);
  const netReceivable = Math.max(0, Math.round(diff - codCharge));

  return {
    cod_amount: cod,
    delivery_charge: delivery,
    cod_charge: codCharge,
    net_receivable: netReceivable
  };
};

exports.calculatePayout = calculatePayout;

exports.handleWebhook = async (req, res) => {
  let settings = null;
  try {
    settings = await Settings.findOne();
    const isDebugLogEnabled = settings?.telegramSettings?.enableDebugLogOnSteadfastCallback;
    const isSuccessMsgEnabled = settings?.telegramSettings?.enableSuccessMsgOnSteadfastCallback;

    const payload = req.body || {};

    if (isDebugLogEnabled) {
      logSteadfastWebhook(`Received Webhook Request. Payload: ${JSON.stringify(payload)}`);
    }

    // 1. Authenticate Token (Supports Bearer token, plain header, or optional fallback)
    const expectedToken = settings?.steadfastSettings?.webhookToken;
    const authHeader = String(req.headers.authorization || req.headers['Authorization'] || '').trim();
    const xWebhookToken = String(req.headers['x-webhook-token'] || req.headers['x-signature'] || '').trim();

    let isAuthenticated = !expectedToken; // If not configured, allow for testing

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (expectedToken && token === expectedToken) {
        isAuthenticated = true;
      }
    } else if (authHeader && expectedToken && authHeader === expectedToken) {
      isAuthenticated = true;
    } else if (xWebhookToken && expectedToken && xWebhookToken === expectedToken) {
      isAuthenticated = true;
    }

    if (!isAuthenticated && expectedToken) {
      const errMsg = 'Missing or unauthorized webhook token';
      if (isDebugLogEnabled) logSteadfastWebhook(`Auth Error: ${errMsg}`);
      sendTelegramAlert(settings, `🚨 <b>Steadfast Webhook Error</b>\n${errMsg}`);
      return res.status(401).json({ status: 'error', message: errMsg });
    }

    // 2. Parse & Normalize Payload
    const notification_type = String(payload.notification_type || (payload.status ? 'delivery_status' : 'tracking_update')).trim();
    const consignment_id = Number(payload.consignment_id || payload.consignmentId) || null;
    const invoice = String(payload.invoice || payload.order_id || payload.orderNumber || '').trim();
    const status = String(payload.status || payload.delivery_status || '').trim().toLowerCase();
    const tracking_code = payload.tracking_code || payload.tracking_id || payload.trackingCode || null;
    const tracking_message = payload.tracking_message || payload.note || payload.text || payload.message || (status ? `Parcel status updated to ${status}` : 'Update received');
    const cod_amount_raw = payload.cod_amount !== undefined ? payload.cod_amount : payload.collected_amount;
    const delivery_charge_raw = payload.delivery_charge !== undefined ? payload.delivery_charge : payload.delivery_fee;
    const updated_at = payload.updated_at ? new Date(payload.updated_at) : new Date();

    if (!consignment_id && !invoice) {
      const errMsg = 'Missing required fields (consignment_id or invoice)';
      if (isDebugLogEnabled) logSteadfastWebhook(`Validation Error: ${errMsg}`);
      await logSteadfastError('Webhook Validation', errMsg, { payload });
      return res.status(400).json({ status: 'error', message: errMsg });
    }

    // Determine codAmount and deliveryCharge for financial calculation
    const cod_num = typeof cod_amount_raw === 'number' || typeof cod_amount_raw === 'string' ? Number(cod_amount_raw) : 0;
    const delivery_num = typeof delivery_charge_raw === 'number' || typeof delivery_charge_raw === 'string' ? Number(delivery_charge_raw) : 0;
    const payout = calculatePayout(cod_num, delivery_num);

    // 3. Store Tracking History in SteadfastTracking Collection
    try {
      await SteadfastTracking.create({
        notification_type,
        consignment_id: consignment_id || 0,
        invoice: invoice || undefined,
        status: status || undefined,
        tracking_message,
        cod_amount: payout.cod_amount,
        delivery_charge: payout.delivery_charge,
        cod_charge: payout.cod_charge,
        net_amount: payout.net_receivable,
        source: 'webhook',
        updated_at_steadfast: isNaN(updated_at.getTime()) ? new Date() : updated_at,
        raw_payload: payload
      });
    } catch (trackErr) {
      console.error('Error storing SteadfastTracking:', trackErr.message);
    }

    // 4. Update Matching Order in Database
    let orderUpdateMsg = 'No order status change required.';
    let isIgnored = false;

    let query = null;
    if (invoice) {
      if (mongoose.Types.ObjectId.isValid(invoice)) {
        query = { $or: [{ orderId: invoice }, { _id: invoice }] };
      } else {
        query = { orderId: invoice };
      }
    } else if (consignment_id) {
      query = { steadfastConsignmentId: String(consignment_id) };
    }

    if (query) {
      const order = await Order.findOne(query);

      if (order) {
        let orderUpdated = false;

        // Ensure Steadfast IDs are assigned
        if (consignment_id && !order.steadfastConsignmentId) {
          order.steadfastConsignmentId = String(consignment_id);
          order.isAddedIntoSteadfast = true;
          orderUpdated = true;
        }
        if (tracking_code && !order.steadfastTrackingCode) {
          order.steadfastTrackingCode = String(tracking_code);
          orderUpdated = true;
        }

        order.steadfastUpdatedAt = new Date();
        if (tracking_message) {
          order.steadfastLastTrackingMessage = tracking_message;
        }

        // Update financial settlement values if provided in webhook
        if (cod_amount_raw !== undefined || delivery_charge_raw !== undefined) {
          order.steadfastCollectedAmount = payout.cod_amount;
          order.steadfastDeliveryCharge = payout.delivery_charge;
          order.steadfastCodCharge = payout.cod_charge;
          order.steadfastReceivableAmount = payout.net_receivable;
          orderUpdated = true;
        }

        // Handle Delivery Status Transitions
        const normalizedStatus = status ? status.toLowerCase() : '';
        if (normalizedStatus) {
          order.steadfastDeliveryStatus = normalizedStatus;
          orderUpdated = true;

          if (normalizedStatus === 'delivered' && order.status !== 'delivered') {
            order.status = 'delivered';
            if (order.paymentStatus !== 'paid') {
              order.paymentStatus = 'paid';
            }
            if (!order.statusTimestamps) order.statusTimestamps = {};
            order.statusTimestamps.delivered = new Date();
            orderUpdated = true;
            orderUpdateMsg = `Order marked as Delivered. Net Payout: ৳${payout.net_receivable}`;
          } else if (normalizedStatus === 'partial_delivered' && order.status !== 'partial_delivered') {
            order.status = 'partial_delivered';
            if (!order.statusTimestamps) order.statusTimestamps = {};
            order.statusTimestamps.partial_delivered = new Date();
            orderUpdated = true;
            orderUpdateMsg = `Order marked as Partial Delivered. Net Payout: ৳${payout.net_receivable}`;
          } else if (normalizedStatus === 'cancelled' && order.status !== 'cancelled') {
            order.status = 'cancelled';
            if (!order.statusTimestamps) order.statusTimestamps = {};
            order.statusTimestamps.cancelled = new Date();
            orderUpdated = true;
            orderUpdateMsg = 'Order marked as Cancelled by Steadfast.';
          }
        }

        if (orderUpdated) {
          await order.save();
        } else {
          isIgnored = true;
          orderUpdateMsg = `No critical order update required for status: ${status}.`;
        }
      } else {
        isIgnored = true;
        orderUpdateMsg = `Order with invoice ${invoice} or consignment_id ${consignment_id} not found in database.`;
      }
    } else {
      isIgnored = true;
      orderUpdateMsg = 'No valid query parameters (invoice or consignment_id) found.';
    }

    if (isDebugLogEnabled) logSteadfastWebhook(`Successfully Processed: ${invoice || consignment_id}. ${orderUpdateMsg}`);
    
    if (isSuccessMsgEnabled && !isIgnored && notification_type === 'delivery_status') {
      const msg = `📦 <b>New Steadfast Callback</b>
<b>Invoice:</b> ${invoice || 'N/A'}
<b>Consignment:</b> ${consignment_id || 'N/A'}
<b>Type:</b> ${notification_type}
<b>Status:</b> ${status || 'N/A'}
<b>System Update:</b> ${orderUpdateMsg}`;
      sendTelegramAlert(settings, msg);
    }

    // 5. Respond with Success
    return res.status(200).json({
      status: 'success',
      message: 'Webhook received successfully.',
      orderUpdateMsg
    });

  } catch (error) {
    console.error('Steadfast Webhook Error:', error);
    await logSteadfastError('Webhook Handler', error, { body: req.body });
    
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error processing webhook'
    });
  }
};

exports.getTrackingHistory = async (req, res) => {
  try {
    const { invoice } = req.params;
    
    // Find all tracking updates for this invoice, sorted by latest first
    const trackingHistory = await SteadfastTracking.find({ 
      $or: [
        { invoice },
        { invoice: String(invoice).toUpperCase() }
      ]
    })
      .sort({ updated_at_steadfast: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: 'Tracking history retrieved successfully',
      data: trackingHistory
    });
  } catch (error) {
    console.error('Error fetching tracking history:', error);
    await logSteadfastError('Get Tracking History', error, { invoice: req.params.invoice });
    return res.status(500).json({
      success: false,
      message: 'Server error fetching tracking history'
    });
  }
};

/**
 * Live Step-by-Step Courier Tracking by Invoice (Merges live Steadfast API + DB Webhook Logs)
 * Automatically syncs financial settlement & status on page visit
 */
exports.getLiveTracking = async (req, res) => {
  try {
    const { invoice } = req.params;
    if (!invoice) {
      return res.status(400).json({ success: false, message: 'Invoice number is required' });
    }

    // 1. Find matching order
    let order = null;
    if (mongoose.Types.ObjectId.isValid(invoice)) {
      order = await Order.findOne({ $or: [{ orderId: invoice }, { _id: invoice }] });
    } else {
      order = await Order.findOne({ orderId: invoice });
    }

    const orderInvoice = order?.orderId || invoice;
    const consignmentId = order?.steadfastConsignmentId;
    const trackingCode = order?.steadfastTrackingCode;

    // 2. Query Steadfast Live Tracking Milestones from API
    let liveSteps = [];
    try {
      const liveApiRes = await steadfastService.getTrackingByInvoice(orderInvoice);
      if (liveApiRes.success && liveApiRes.data) {
        liveSteps = Array.isArray(liveApiRes.data.tracking)
          ? liveApiRes.data.tracking
          : (Array.isArray(liveApiRes.data.trackings) ? liveApiRes.data.trackings : []);
      }
    } catch (err) {
      console.warn('Steadfast live tracking fetch notice:', err.message);
    }

    // 3. Query Steadfast Status & Delivery Charge if consignmentId available
    let liveStatusData = null;
    if (consignmentId) {
      try {
        const statusRes = await steadfastService.getStatusByConsignmentId(consignmentId);
        if (statusRes.success && statusRes.data) {
          liveStatusData = statusRes.data;
        }
      } catch (err) {
        console.warn('Steadfast status by cid notice:', err.message);
      }
    } else if (trackingCode) {
      try {
        const statusRes = await steadfastService.getStatusByTrackingCode(trackingCode);
        if (statusRes.success && statusRes.data) {
          liveStatusData = statusRes.data;
        }
      } catch (err) {
        console.warn('Steadfast status by tracking code notice:', err.message);
      }
    }

    // 4. Query Webhook History from DB
    const dbQuery = {
      $or: [
        { invoice: orderInvoice },
        { invoice: String(orderInvoice).toUpperCase() }
      ]
    };
    if (consignmentId) {
      dbQuery.$or.push({ consignment_id: Number(consignmentId) });
    }
    const webhookHistory = await SteadfastTracking.find(dbQuery)
      .sort({ updated_at_steadfast: -1, createdAt: -1 })
      .lean();

    // 5. Calculate Financial Settlement Payout
    const statusData = liveStatusData?.data || liveStatusData;
    const apiCodAmount = statusData?.cod_amount ?? statusData?.collected_amount;
    const apiDeliveryCharge = statusData?.delivery_charge;
    const apiDeliveryStatus = statusData?.delivery_status || statusData?.status;

    const deliveryCharge = apiDeliveryCharge !== undefined && apiDeliveryCharge !== null
      ? Number(apiDeliveryCharge)
      : (order?.steadfastDeliveryCharge > 0 
          ? order.steadfastDeliveryCharge 
          : (order?.shippingCost > 0 ? order.shippingCost : 70));

    const codAmount = apiCodAmount !== undefined && apiCodAmount !== null
      ? Number(apiCodAmount)
      : (order?.steadfastCollectedAmount > 0 
          ? order.steadfastCollectedAmount 
          : (order?.paymentStatus === 'paid' ? 0 : (order?.totalAmount || order?.total || 0)));

    const payout = calculatePayout(codAmount, deliveryCharge);

    // 6. Sync Order Status & Financial Fields if delivered or values updated
    if (order) {
      let orderChanged = false;

      if (order.steadfastCollectedAmount !== payout.cod_amount) {
        order.steadfastCollectedAmount = payout.cod_amount;
        orderChanged = true;
      }
      if (order.steadfastDeliveryCharge !== payout.delivery_charge) {
        order.steadfastDeliveryCharge = payout.delivery_charge;
        orderChanged = true;
      }
      if (order.steadfastCodCharge !== payout.cod_charge) {
        order.steadfastCodCharge = payout.cod_charge;
        orderChanged = true;
      }
      if (order.steadfastReceivableAmount !== payout.net_receivable) {
        order.steadfastReceivableAmount = payout.net_receivable;
        orderChanged = true;
      }
      if (apiDeliveryStatus && order.steadfastDeliveryStatus !== apiDeliveryStatus) {
        order.steadfastDeliveryStatus = apiDeliveryStatus;
        orderChanged = true;
      }

      const normalizedStatus = String(apiDeliveryStatus || '').toLowerCase();
      if ((normalizedStatus === 'delivered' || normalizedStatus === 'partial_delivered') && order.status !== 'delivered') {
        order.status = 'delivered';
        order.paymentStatus = 'paid';
        if (!order.statusTimestamps) order.statusTimestamps = {};
        order.statusTimestamps.delivered = new Date();
        orderChanged = true;
      }

      if (orderChanged) {
        await order.save();
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        invoice: orderInvoice,
        consignmentId,
        trackingCode,
        currentStatus: order?.status,
        liveSteps,
        webhookHistory,
        payout
      }
    });

  } catch (error) {
    console.error('Error in getLiveTracking:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error fetching live tracking'
    });
  }
};

// Get current merchant balance from Steadfast
exports.getBalance = async (req, res) => {
  try {
    const response = await steadfastService.getBalance();
    if (!response.success) {
      return res.status(response.statusCode || 400).json({
        success: false,
        message: response.error?.message || 'Failed to fetch Steadfast balance',
        error: response.error
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Steadfast balance retrieved successfully',
      data: response.data
    });
  } catch (error) {
    console.error('Error getting Steadfast balance:', error);
    await logSteadfastError('Get Balance Controller', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error fetching Steadfast balance'
    });
  }
};

// Check customer delivery stats and fraud check score with 24-hour cache
exports.getFraudScore = async (req, res) => {
  try {
    const rawPhone = req.params.phone || req.query.phone;
    if (!rawPhone) {
      return res.status(400).json({
        success: false,
        message: 'Customer phone number is required'
      });
    }

    // Clean phone number (e.g. 017xxxxxxxx)
    let cleanedPhone = String(rawPhone).replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanedPhone.startsWith('+880')) {
      cleanedPhone = '0' + cleanedPhone.slice(4);
    } else if (cleanedPhone.startsWith('880')) {
      cleanedPhone = '0' + cleanedPhone.slice(3);
    }

    const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
    const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

    // 1. If not forcing refresh, check database cache to prevent Steadfast rate limits
    if (!forceRefresh) {
      const cached = await CustomerScoreCache.findOne({ phone: cleanedPhone });
      if (cached && cached.scoreData && cached.lastFetchedAt) {
        const ageMs = Date.now() - new Date(cached.lastFetchedAt).getTime();
        if (ageMs < CACHE_DURATION_MS) {
          return res.status(200).json({
            success: true,
            cached: true,
            cachedAt: cached.lastFetchedAt,
            expiresInHours: Math.max(1, Math.round((CACHE_DURATION_MS - ageMs) / (60 * 60 * 1000))),
            message: 'Customer courier score retrieved from 24h cache',
            data: cached.scoreData
          });
        }
      }
    }

    // 2. Fetch fresh from Steadfast API
    const response = await steadfastService.checkFraudScore(cleanedPhone);
    if (!response.success) {
      // If API fails (e.g. rate limit), check if we have ANY older cached record as a fallback
      const fallback = await CustomerScoreCache.findOne({ phone: cleanedPhone });
      if (fallback && fallback.scoreData) {
        return res.status(200).json({
          success: true,
          cached: true,
          isFallback: true,
          cachedAt: fallback.lastFetchedAt,
          message: 'Steadfast API busy/rate-limited. Showing latest saved record.',
          data: fallback.scoreData
        });
      }

      return res.status(response.statusCode || 400).json({
        success: false,
        message: response.error?.message || 'Failed to fetch fraud score from Steadfast',
        error: response.error
      });
    }

    // 3. Save / Update Cache for 24 hours
    await CustomerScoreCache.findOneAndUpdate(
      { phone: cleanedPhone },
      {
        phone: cleanedPhone,
        scoreData: response.data,
        lastFetchedAt: new Date()
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      cached: false,
      cachedAt: new Date(),
      message: 'Fresh customer courier score retrieved from Steadfast',
      data: response.data
    });
  } catch (error) {
    console.error('Error in fraud score controller:', error);
    await logSteadfastError('Fraud Score Controller', error, { phone: req.params.phone });
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during fraud check'
    });
  }
};

// Test connection to Steadfast API with current credentials
exports.checkConnection = async (req, res) => {
  try {
    const pingRes = await steadfastService.ping();
    const balanceRes = await steadfastService.getBalance();

    if (balanceRes.success) {
      return res.status(200).json({
        success: true,
        message: 'Successfully connected and authenticated with Steadfast API',
        data: {
          ping: pingRes.data,
          balance: balanceRes.data
        }
      });
    }

    return res.status(balanceRes.statusCode || 400).json({
      success: false,
      message: balanceRes.error?.message || 'Connection failed: API Key or Secret Key is invalid.',
      error: balanceRes.error
    });
  } catch (error) {
    console.error('Steadfast connection check error:', error);
    await logSteadfastError('Check Connection', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Connection check failed'
    });
  }
};

// Safely read steadfast_error.log (Admin only)
exports.getLogs = async (req, res) => {
  try {
    const logDir = path.join(__dirname, '../../../logs');
    const logFile = path.join(logDir, 'steadfast_error.log');

    if (!fs.existsSync(logFile)) {
      return res.status(200).json({
        success: true,
        message: 'No error logs found',
        data: {
          content: '',
          size: 0,
          lines: 0,
          lastModified: null
        }
      });
    }

    const stats = await fs.promises.stat(logFile);
    // Limit memory read to max 2MB in production to prevent crashes
    const MAX_SIZE = 2 * 1024 * 1024; // 2MB
    let content = '';

    if (stats.size > MAX_SIZE) {
      // Read only the last 2MB
      const buffer = Buffer.alloc(MAX_SIZE);
      const fd = await fs.promises.open(logFile, 'r');
      await fd.read(buffer, 0, MAX_SIZE, stats.size - MAX_SIZE);
      await fd.close();
      content = buffer.toString('utf8');
    } else {
      content = await fs.promises.readFile(logFile, 'utf8');
    }

    const lineCount = content ? content.split('\n').filter(Boolean).length : 0;

    return res.status(200).json({
      success: true,
      message: 'Logs fetched successfully',
      data: {
        content,
        size: stats.size,
        lines: lineCount,
        lastModified: stats.mtime
      }
    });
  } catch (error) {
    console.error('Error reading steadfast error logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to read steadfast error logs: ' + error.message
    });
  }
};

// Safely update/edit steadfast_error.log (Admin only)
exports.updateLogs = async (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid content format'
      });
    }

    const logDir = path.join(__dirname, '../../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'steadfast_error.log');

    await fs.promises.writeFile(logFile, content, 'utf8');

    const stats = await fs.promises.stat(logFile);
    const lineCount = content ? content.split('\n').filter(Boolean).length : 0;

    return res.status(200).json({
      success: true,
      message: 'Steadfast error logs updated successfully',
      data: {
        size: stats.size,
        lines: lineCount,
        lastModified: stats.mtime
      }
    });
  } catch (error) {
    console.error('Error writing steadfast error logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save error logs: ' + error.message
    });
  }
};

// Safely clear/truncate steadfast_error.log (Admin only)
exports.clearLogs = async (req, res) => {
  try {
    const logDir = path.join(__dirname, '../../../logs');
    const logFile = path.join(logDir, 'steadfast_error.log');

    if (fs.existsSync(logFile)) {
      await fs.promises.writeFile(logFile, '', 'utf8');
    }

    return res.status(200).json({
      success: true,
      message: 'Steadfast error logs cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing steadfast error logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to clear error logs: ' + error.message
    });
  }
};
