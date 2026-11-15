const fs = require('fs');
const path = require('path');

/**
 * Safely log PipraPay errors only (never success) to logs/piprapay_error.log.
 * Will NEVER throw error or crash the system.
 *
 * @param {string} action - Context/Action name e.g. "Create Charge", "Callback", "Webhook", "Verify Payment"
 * @param {any} error - Error object or message
 * @param {object} [metadata] - Optional additional info like orderId, orderNumber, ppId, amount, request data
 */
const logPiprapayError = (action, error, metadata = {}) => {
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

    const metaStr = metadata && Object.keys(metadata).length ? ` | Meta: ${JSON.stringify(metadata)}` : '';
    const logEntry = `[${timestamp}] [ERROR] [${action}] ${errorMsg}${metaStr}\n`;

    // Safe File Logging (only errors, never crashes)
    try {
      const logDir = path.join(__dirname, '../../../logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logFile = path.join(logDir, 'piprapay_error.log');
      fs.appendFileSync(logFile, logEntry, 'utf8');
    } catch (fsErr) {
      console.error('PipraPay error logger FS warning:', fsErr.message);
    }
  } catch (outerErr) {
    console.error('PipraPay error logger failed safely:', outerErr.message);
  }
};

module.exports = {
  logPiprapayError,
};
