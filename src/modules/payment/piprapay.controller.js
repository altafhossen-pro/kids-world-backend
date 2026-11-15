const path = require('path');
const fs = require('fs');
const piprapayService = require('./piprapay.service');
const { Order } = require('../order/order.model');
const sendResponse = require('../../utils/sendResponse');
const { logPiprapayError } = require('./piprapay.logger');

/**
 * Initiate PipraPay payment for an existing order
 */
exports.initiatePayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const query = orderId.toString().length === 24 
      ? { _id: orderId } 
      : { $or: [{ _id: orderId }, { orderId }] };

    const order = await Order.findOne(query);
    if (!order) {
      return sendResponse({
        res,
        statusCode: 404,
        success: false,
        message: 'Order not found',
      });
    }

    if (order.paymentStatus === 'paid') {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'This order is already marked as paid.',
      });
    }

    const result = await piprapayService.createCharge(order);
    if (!result.success) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: result.message || 'Failed to initiate payment with PipraPay',
      });
    }

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Payment URL generated successfully',
      data: {
        paymentUrl: result.pp_url,
        invoice: result.invoice,
        orderId: order.orderId,
      },
    });
  } catch (error) {
    console.error('Initiate PipraPay Payment Error:', error);
    logPiprapayError('Initiate Payment Exception', error, { orderId: req.params?.orderId });

    return sendResponse({
      res,
      statusCode: 500,
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

/**
 * Handle PipraPay Browser Callback (Customer Redirect after payment)
 */
exports.handleCallback = async (req, res) => {
  const isGet = req.method === 'GET';
  const data = isGet ? req.query : req.body;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const ppId = data.pp_id || data.transaction_ref || data.ppid || req.query.pp_id;

  if (!ppId) {
    logPiprapayError('Callback', 'Transaction reference (pp_id) is missing in callback request', {
      query: req.query,
      body: req.body,
      method: req.method,
    });

    if (isGet || req.headers.accept?.includes('text/html')) {
      return res.redirect(`${frontendUrl}/checkout?error=missing_transaction_ref`);
    }
    return sendResponse({
      res,
      statusCode: 400,
      success: false,
      message: 'Transaction reference (pp_id) is missing',
    });
  }

  try {
    // Verify transaction directly with PipraPay server
    const verification = await piprapayService.verifyPayment(ppId);

    if (!verification.success || !verification.verified) {
      console.warn(`PipraPay Verification Failed for pp_id: ${ppId}`, verification);

      logPiprapayError('Callback Verification Failed', verification.message || 'Payment verification failed', {
        ppId,
        verification,
        query: req.query,
        body: req.body,
      });

      if (isGet || req.headers.accept?.includes('text/html')) {
        return res.redirect(`${frontendUrl}/checkout?error=payment_not_verified`);
      }
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'Payment verification failed with gateway.',
      });
    }

    const payData = verification.data || {};
    let metadata = {};
    if (typeof payData.metadata === 'string') {
      try {
        metadata = JSON.parse(payData.metadata);
      } catch (e) {
        metadata = {};
      }
    } else if (typeof payData.metadata === 'object' && payData.metadata !== null) {
      metadata = payData.metadata;
    }

    const targetOrderId = metadata.orderId || metadata.orderNumber || data.order_id || req.query.order_id;

    let updatedOrder = null;
    if (targetOrderId) {
      updatedOrder = await piprapayService.processSuccess(targetOrderId, payData);
    } else {
      // Find order by matching amount or search in piprapayDetails
      updatedOrder = await Order.findOne({ 'piprapayDetails.ppId': ppId });
      if (!updatedOrder) {
        console.error('Could not determine Order ID from PipraPay callback metadata:', payData);
        logPiprapayError('Callback Order Lookup', 'Could not determine Order ID from PipraPay callback metadata', {
          ppId,
          metadata: payData.metadata,
        });
      }
    }

    if (isGet || req.headers.accept?.includes('text/html')) {
      const orderIdParam = updatedOrder ? updatedOrder.orderId : (metadata.orderNumber || targetOrderId || '');
      const orderStatus = updatedOrder ? updatedOrder.status : 'pending';
      const orderTotal = updatedOrder ? updatedOrder.total : payData.amount;
      return res.redirect(
        `${frontendUrl}/order-confirmation?orderId=${orderIdParam}&status=${orderStatus}&total=${orderTotal}&paymentStatus=paid`
      );
    }

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Payment verified and order updated successfully.',
      data: updatedOrder,
    });
  } catch (error) {
    console.error('PipraPay Callback Handler Error:', error);

    logPiprapayError('Callback Exception', error, {
      ppId,
      query: req.query,
      body: req.body,
      method: req.method,
    });

    if (isGet || req.headers.accept?.includes('text/html')) {
      return res.redirect(`${frontendUrl}/checkout?error=internal_callback_error`);
    }
    return sendResponse({
      res,
      statusCode: 500,
      success: false,
      message: error.message || 'Internal server error processing callback',
    });
  }
};

/**
 * Handle PipraPay Webhook (Server-to-Server IPN)
 */
exports.handleWebhook = async (req, res) => {
  const data = req.body || {};
  const ppId = data.pp_id || data.transaction_ref || req.query.pp_id;

  if (!ppId) {
    logPiprapayError('Webhook', 'Webhook received without transaction reference (pp_id)', {
      query: req.query,
      body: req.body,
    });
    return res.status(400).json({ status: 'error', message: 'pp_id missing' });
  }

  try {
    const verification = await piprapayService.verifyPayment(ppId);
    if (!verification.success || !verification.verified) {
      logPiprapayError('Webhook Verification Failed', verification.message || 'Webhook verification failed', {
        ppId,
        verification,
        body: req.body,
      });
      return res.status(400).json({ status: 'error', message: 'Verification failed' });
    }

    const payData = verification.data || {};
    let metadata = {};
    if (typeof payData.metadata === 'string') {
      try {
        metadata = JSON.parse(payData.metadata);
      } catch (e) {
        metadata = {};
      }
    } else if (typeof payData.metadata === 'object' && payData.metadata !== null) {
      metadata = payData.metadata;
    }

    const targetOrderId = metadata.orderId || metadata.orderNumber || data.order_id;
    if (targetOrderId) {
      await piprapayService.processSuccess(targetOrderId, payData);
    }

    return res.status(200).json({ status: 'success', message: 'Webhook processed' });
  } catch (error) {
    console.error('PipraPay Webhook Error:', error);
    logPiprapayError('Webhook Exception', error, { ppId, body: req.body });
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Safely read piprapay_error.log (Admin only)
 */
exports.getLogs = async (req, res) => {
  try {
    const logDir = path.join(__dirname, '../../../logs');
    const logFile = path.join(logDir, 'piprapay_error.log');

    if (!fs.existsSync(logFile)) {
      return res.status(200).json({
        success: true,
        message: 'No error logs found',
        data: {
          content: '',
          size: 0,
          lines: 0,
          lastModified: null,
        },
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
        lastModified: stats.mtime,
      },
    });
  } catch (error) {
    console.error('Error reading PipraPay error logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to read PipraPay error logs: ' + error.message,
    });
  }
};

/**
 * Safely update/edit piprapay_error.log (Admin only)
 */
exports.updateLogs = async (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid content format',
      });
    }

    const logDir = path.join(__dirname, '../../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'piprapay_error.log');

    await fs.promises.writeFile(logFile, content, 'utf8');

    const stats = await fs.promises.stat(logFile);
    const lineCount = content ? content.split('\n').filter(Boolean).length : 0;

    return res.status(200).json({
      success: true,
      message: 'PipraPay error logs updated successfully',
      data: {
        size: stats.size,
        lines: lineCount,
        lastModified: stats.mtime,
      },
    });
  } catch (error) {
    console.error('Error writing PipraPay error logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save error logs: ' + error.message,
    });
  }
};

/**
 * Safely clear/truncate piprapay_error.log (Admin only)
 */
exports.clearLogs = async (req, res) => {
  try {
    const logDir = path.join(__dirname, '../../../logs');
    const logFile = path.join(logDir, 'piprapay_error.log');

    if (fs.existsSync(logFile)) {
      await fs.promises.writeFile(logFile, '', 'utf8');
    }

    return res.status(200).json({
      success: true,
      message: 'PipraPay error logs cleared successfully',
    });
  } catch (error) {
    console.error('Error clearing PipraPay error logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to clear error logs: ' + error.message,
    });
  }
};
