const crypto = require('crypto');
const axios = require('axios');
const MetaPixel = require('./metaPixel.model');
const sendResponse = require('../../utils/sendResponse');

// Helper to hash values with SHA-256 for Meta Event Match Quality (EMQ)
const hashData = (value) => {
  if (!value || typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

// Helper to normalize and hash phone numbers
const hashPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return undefined;
  let digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  // If Bangladesh number without country code (e.g. 017... or 018...)
  if (digits.startsWith('01') && digits.length === 11) {
    digits = '88' + digits;
  }
  return crypto.createHash('sha256').update(digits).digest('hex');
};

// Helper to get or initialize settings
const getOrCreateSettings = async () => {
  let settings = await MetaPixel.findOne();
  if (!settings) {
    settings = await MetaPixel.create({
      isEnabled: false,
      pixelCode: '',
      pixelId: '',
      conversionsApiToken: '',
      testEventCode: '',
      trackedEvents: {
        pageView: true,
        viewCategory: true,
        viewContent: true,
        search: true,
        addToCart: true,
        initiateCheckout: true,
        completeRegistration: true,
        contact: true,
        purchase: true
      }
    });
  }
  return settings;
};

// @desc    Get full settings (Admin only)
// @route   GET /api/v1/meta-pixel/admin
// @access  Private/Admin
exports.getAdminSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Meta Pixel settings retrieved',
      data: settings
    });
  } catch (error) {
    console.error('Error in getAdminSettings:', error);
    return sendResponse({
      res,
      statusCode: 500,
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Get public settings for storefront (no secret tokens)
// @route   GET /api/v1/meta-pixel/public
// @access  Public
exports.getPublicSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      data: {
        isEnabled: settings.isEnabled,
        pixelId: settings.pixelId,
        pixelCode: settings.pixelCode,
        trackedEvents: settings.trackedEvents || {}
      }
    });
  } catch (error) {
    console.error('Error in getPublicSettings:', error);
    return sendResponse({
      res,
      statusCode: 500,
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Update settings (Admin only)
// @route   PUT /api/v1/meta-pixel
// @access  Private/Admin
exports.updateSettings = async (req, res) => {
  try {
    const {
      isEnabled,
      pixelCode,
      pixelId,
      conversionsApiToken,
      testEventCode,
      trackedEvents
    } = req.body;

    let settings = await getOrCreateSettings();

    // Auto-detect Pixel ID from code if not explicitly given or changed
    let resolvedPixelId = (pixelId || '').trim();
    if (!resolvedPixelId && pixelCode) {
      const match = pixelCode.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d+)['"]\s*\)/);
      if (match && match[1]) {
        resolvedPixelId = match[1];
      }
    }

    if (typeof isEnabled === 'boolean') settings.isEnabled = isEnabled;
    if (pixelCode !== undefined) settings.pixelCode = pixelCode.trim();
    if (resolvedPixelId !== undefined) settings.pixelId = resolvedPixelId;
    if (conversionsApiToken !== undefined) settings.conversionsApiToken = conversionsApiToken.trim();
    if (testEventCode !== undefined) settings.testEventCode = testEventCode.trim();
    if (trackedEvents && typeof trackedEvents === 'object') {
      settings.trackedEvents = {
        ...settings.trackedEvents,
        ...trackedEvents
      };
    }

    if (req.user?._id) {
      settings.updatedBy = req.user._id;
    }

    await settings.save();

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Meta Pixel & Conversions API settings updated successfully',
      data: settings
    });
  } catch (error) {
    console.error('Error in updateSettings:', error);
    return sendResponse({
      res,
      statusCode: 500,
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Track Server-Side Event via Meta Conversions API (CAPI)
// @route   POST /api/v1/meta-pixel/track
// @access  Public
exports.trackServerEvent = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();

    if (!settings.isEnabled || !settings.pixelId || !settings.conversionsApiToken) {
      return sendResponse({
        res,
        statusCode: 200,
        success: false,
        message: 'Meta Pixel or Conversions API is not active'
      });
    }

    const {
      eventName,
      eventId,
      eventSourceUrl,
      userData = {},
      customData = {},
      testEventCode
    } = req.body;

    if (!eventName) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'eventName is required'
      });
    }

    // Map event name to trackedEvents key
    const eventKeyMap = {
      PageView: 'pageView',
      ViewCategory: 'viewCategory',
      ViewContent: 'viewContent',
      Search: 'search',
      AddToCart: 'addToCart',
      InitiateCheckout: 'initiateCheckout',
      CompleteRegistration: 'completeRegistration',
      Contact: 'contact',
      Purchase: 'purchase'
    };

    const configKey = eventKeyMap[eventName];
    if (configKey && settings.trackedEvents && settings.trackedEvents[configKey] === false) {
      return sendResponse({
        res,
        statusCode: 200,
        success: true,
        message: `Event ${eventName} tracking is disabled in settings`
      });
    }

    // Client IP and User Agent
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    // Build hashed user_data
    const formattedUserData = {
      client_ip_address: clientIp,
      client_user_agent: userAgent
    };

    if (userData.email) {
      const hashedEmail = hashData(userData.email);
      if (hashedEmail) formattedUserData.em = [hashedEmail];
    }
    if (userData.phone) {
      const hashedPhone = hashPhone(userData.phone);
      if (hashedPhone) formattedUserData.ph = [hashedPhone];
    }
    if (userData.firstName) {
      const hashedFn = hashData(userData.firstName);
      if (hashedFn) formattedUserData.fn = [hashedFn];
    }
    if (userData.lastName) {
      const hashedLn = hashData(userData.lastName);
      if (hashedLn) formattedUserData.ln = [hashedLn];
    }
    if (userData.fbp || req.cookies?._fbp) {
      formattedUserData.fbp = userData.fbp || req.cookies?._fbp;
    }
    if (userData.fbc || req.cookies?._fbc) {
      formattedUserData.fbc = userData.fbc || req.cookies?._fbc;
    }

    const eventPayload = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: eventSourceUrl || req.headers.referer || '',
      user_data: formattedUserData,
      custom_data: customData
    };

    if (eventId) {
      eventPayload.event_id = eventId;
    }

    const requestBody = {
      data: [eventPayload]
    };

    const activeTestCode = testEventCode || settings.testEventCode;
    if (activeTestCode) {
      requestBody.test_event_code = activeTestCode;
    }

    // Send to Meta Graph API v19.0
    const metaUrl = `https://graph.facebook.com/v19.0/${settings.pixelId}/events?access_token=${settings.conversionsApiToken}`;

    const response = await axios.post(metaUrl, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000
    });

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: `CAPI Event ${eventName} sent successfully`,
      data: response.data
    });
  } catch (error) {
    const errorDetails = error.response?.data?.error || error.message;
    console.error('Error dispatching Meta CAPI event:', errorDetails);
    return sendResponse({
      res,
      statusCode: 200, // Return 200 so storefront won't fail
      success: false,
      message: 'Failed to send event to Meta',
      data: errorDetails
    });
  }
};

// @desc    Send test event directly from Admin Test Tool
// @route   POST /api/v1/meta-pixel/test-event
// @access  Private/Admin
exports.sendTestEvent = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();

    const testEventCode = (req.body.testEventCode || settings.testEventCode || '').trim();
    const pixelId = (req.body.pixelId || settings.pixelId || '').trim();
    const token = (req.body.conversionsApiToken || settings.conversionsApiToken || '').trim();

    if (!pixelId) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'Meta Pixel ID is required for testing'
      });
    }

    if (!token) {
      return sendResponse({
        res,
        statusCode: 400,
        success: false,
        message: 'Conversions API Access Token is required for testing'
      });
    }

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Mozilla/5.0 Test Tool';

    const testPayload = {
      data: [
        {
          event_name: 'PageView',
          event_time: Math.floor(Date.now() / 1000),
          event_id: `test_${Date.now()}`,
          action_source: 'website',
          event_source_url: req.headers.referer || 'https://kidsworldbd.com/admin/dashboard/settings/meta-pixel',
          user_data: {
            client_ip_address: clientIp,
            client_user_agent: userAgent,
            em: [crypto.createHash('sha256').update('test@example.com').digest('hex')]
          },
          custom_data: {
            status: 'Diagnostic Connectivity Test via Admin Dashboard',
            version: 'Meta Graph v19.0'
          }
        }
      ]
    };

    if (testEventCode) {
      testPayload.test_event_code = testEventCode;
    }

    const metaUrl = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${token}`;

    const response = await axios.post(metaUrl, testPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    return sendResponse({
      res,
      statusCode: 200,
      success: true,
      message: 'Test event dispatched to Meta successfully!',
      data: response.data
    });
  } catch (error) {
    const metaError = error.response?.data?.error || error.response?.data || { message: error.message };
    console.error('Meta Test Event Error:', metaError);
    return sendResponse({
      res,
      statusCode: 400,
      success: false,
      message: metaError.message || 'Meta API returned an error',
      data: metaError
    });
  }
};
