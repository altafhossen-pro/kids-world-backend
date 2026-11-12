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

exports.handleWebhook = async (req, res) => {
  try {
    // Get settings
    const settings = await Settings.findOne();
    const isDebugLogEnabled = settings?.telegramSettings?.enableDebugLogOnSteadfastCallback;
    const isSuccessMsgEnabled = settings?.telegramSettings?.enableSuccessMsgOnSteadfastCallback;

    if (isDebugLogEnabled) {
      logSteadfastWebhook(`Received Webhook Request. Payload: ${JSON.stringify(req.body)}`);
    }

    // 1. Authenticate Token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const errMsg = 'Missing or invalid Authorization header';
      if (isDebugLogEnabled) logSteadfastWebhook(`Auth Error: ${errMsg}`);
      sendTelegramAlert(settings, `🚨 <b>Steadfast Webhook Error</b>\n${errMsg}`);
      return res.status(401).json({ status: 'error', message: errMsg });
    }

    const token = authHeader.split(' ')[1];
    const expectedToken = settings?.steadfastSettings?.webhookToken;

    if (!expectedToken || token !== expectedToken) {
      const errMsg = 'Unauthorized webhook token';
      if (isDebugLogEnabled) logSteadfastWebhook(`Auth Error: ${errMsg}`);
      sendTelegramAlert(settings, `🚨 <b>Steadfast Webhook Error</b>\n${errMsg}`);
      return res.status(401).json({ status: 'error', message: errMsg });
    }

    // 2. Parse Payload
    const payload = req.body;
    const {
      notification_type,
      consignment_id,
      invoice,
      status,
      tracking_message,
      cod_amount,
      delivery_charge,
      updated_at
    } = payload;

    if (!notification_type || !consignment_id) {
      const errMsg = 'Missing required fields (notification_type or consignment_id)';
      if (isDebugLogEnabled) logSteadfastWebhook(`Validation Error: ${errMsg}`);
      await logSteadfastError('Webhook Validation', errMsg, { payload });
      return res.status(400).json({ status: 'error', message: errMsg });
    }

    // 3. Store Tracking History (for delivery_status, tracking_update, return_status)
    const validTrackingEnums = ['delivery_status', 'tracking_update', 'return_status'];
    if (validTrackingEnums.includes(notification_type)) {
      try {
        await SteadfastTracking.create({
          notification_type,
          consignment_id,
          invoice: invoice || undefined,
          status: status || undefined,
          tracking_message: tracking_message || (status ? `Status updated: ${status}` : 'Update received'),
          cod_amount: typeof cod_amount === 'number' || typeof cod_amount === 'string' ? Number(cod_amount) : undefined,
          delivery_charge: typeof delivery_charge === 'number' || typeof delivery_charge === 'string' ? Number(delivery_charge) : undefined,
          updated_at_steadfast: updated_at ? new Date(updated_at) : new Date(),
          raw_payload: payload
        });
      } catch (trackErr) {
        console.error('Error storing SteadfastTracking:', trackErr.message);
      }
    }

    // Non-delivery events (like tracking step or return status) don't alter the order status directly
    if (notification_type !== 'delivery_status') {
      return res.status(200).json({
        status: 'success',
        message: `Webhook event ${notification_type} recorded successfully.`
      });
    }

    // 4. Update Order Status if delivery_status
    let orderUpdateMsg = 'No order status change required.';
    let isIgnored = false;

    if (notification_type === 'delivery_status') {
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
          const normalizedStatus = status ? status.toLowerCase() : '';

          if (normalizedStatus === 'delivered' && order.status !== 'delivered') {
            order.status = 'delivered';
            if (order.paymentStatus === 'pending') {
              order.paymentStatus = 'paid';
            }
            if (typeof cod_amount === 'number' || typeof cod_amount === 'string') {
              const finalAmount = (Number(cod_amount) || 0) - (Number(delivery_charge) || 0);
              order.steadfastCollectedAmount = finalAmount;
            }
            if (!order.statusTimestamps) order.statusTimestamps = {};
            order.statusTimestamps.delivered = new Date();
            orderUpdated = true;
            orderUpdateMsg = 'Order marked as Delivered.';
          } else if (normalizedStatus === 'cancelled' && order.status !== 'cancelled') {
            order.status = 'cancelled';
            if (!order.statusTimestamps) order.statusTimestamps = {};
            order.statusTimestamps.cancelled = new Date();
            orderUpdated = true;
            orderUpdateMsg = 'Order marked as Cancelled.';
          }

          if (orderUpdated) {
            await order.save();
          } else {
            isIgnored = true;
            orderUpdateMsg = `No order status change required for status: ${status}. Ignored.`;
          }
        } else {
          isIgnored = true;
          orderUpdateMsg = `Order with invoice ${invoice} or consignment_id ${consignment_id} not found in database. Ignored.`;
        }
      } else {
        isIgnored = true;
        orderUpdateMsg = `No valid query parameters (invoice or consignment_id) found. Ignored.`;
      }
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
      message: 'Webhook received successfully.'
    });

  } catch (error) {
    console.error('Steadfast Webhook Error:', error);
    await logSteadfastError('Webhook Handler', error, { body: req.body });
    
    // Even on error processing internally, returning 500 so Steadfast knows it failed.
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
    const trackingHistory = await SteadfastTracking.find({ invoice })
      .sort({ updated_at_steadfast: -1 })
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
