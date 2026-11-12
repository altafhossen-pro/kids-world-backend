const fs = require('fs');
const path = require('path');
const Settings = require('../settings/settings.model');

/**
 * Safely log Steadfast errors only (no success logging) to a dedicated log file
 * and optionally notify Telegram based on settings toggle.
 * Will NEVER throw error or crash the system.
 * 
 * @param {string} action - Context/Action name e.g. "Create Order", "Webhook", "Check Balance", "Fraud Check"
 * @param {any} error - Error object or message
 * @param {object} [metadata] - Optional additional info like invoice, phone, orderId
 */
const logSteadfastError = async (action, error, metadata = {}) => {
  try {
    const timestamp = new Date().toISOString();
    let errorMsg = '';

    if (error?.response?.data) {
      errorMsg = typeof error.response.data === 'object'
        ? JSON.stringify(error.response.data)
        : String(error.response.data);
    } else if (error?.message) {
      errorMsg = error.message;
    } else {
      errorMsg = typeof error === 'object' ? JSON.stringify(error) : String(error);
    }

    const metaStr = Object.keys(metadata).length ? ` | Meta: ${JSON.stringify(metadata)}` : '';
    const logEntry = `[${timestamp}] [ERROR] [${action}] ${errorMsg}${metaStr}\n`;

    // 1. Safe File Logging (only errors, never crashes)
    try {
      const logDir = path.join(__dirname, '../../../logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logFile = path.join(logDir, 'steadfast_error.log');
      fs.appendFileSync(logFile, logEntry);
    } catch (fsErr) {
      console.error('Steadfast error logger FS warning:', fsErr.message);
    }

    // 2. Telegram Alert if toggle is enabled
    try {
      const settings = await Settings.findOne();
      const notifyOnError = settings?.steadfastSettings?.notifyTelegramOnError !== false;
      const botToken = settings?.telegramSettings?.botToken;
      const chatId = settings?.telegramSettings?.chatId;

      if (notifyOnError && botToken && chatId) {
        const cleanMsg = typeof errorMsg === 'string' ? errorMsg.substring(0, 300) : JSON.stringify(errorMsg);
        const tgMessage = `🚨 <b>Steadfast Error Alert</b>
<b>Action:</b> ${action}
<b>Error:</b> <code>${cleanMsg}</code>
${metadata.invoice ? `<b>Invoice:</b> ${metadata.invoice}\n` : ''}${metadata.phone ? `<b>Phone:</b> ${metadata.phone}\n` : ''}${metadata.orderId ? `<b>Order ID:</b> ${metadata.orderId}\n` : ''}`;

        const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: tgMessage, parse_mode: 'HTML' })
        }).catch(() => { });
      }
    } catch (tgErr) {
      console.error('Steadfast telegram alert warning:', tgErr.message);
    }
  } catch (outerErr) {
    // Fail silently to guarantee no crash
    console.error('Safe logSteadfastError encountered error:', outerErr.message);
  }
};

module.exports = {
  logSteadfastError
};
