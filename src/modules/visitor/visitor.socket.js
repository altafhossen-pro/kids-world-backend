const visitorService = require('./visitor.service');

const disconnectTimeouts = new Map();

function cleanIp(ip) {
    if (!ip) return '127.0.0.1';
    let s = String(ip).trim();
    if (s.startsWith('::ffff:')) {
        s = s.substring(7);
    }
    if (s === '::1') return '127.0.0.1';
    return s;
}

function isLocalIp(ip) {
    if (!ip) return true;
    const cleaned = cleanIp(ip);
    return cleaned === '127.0.0.1' || cleaned === '::1' || cleaned === 'localhost';
}

function getClientIpFromSocket(socket) {
    if (!socket) return '127.0.0.1';
    const headers = socket.handshake?.headers || {};
    
    // Check proxy headers in order of priority (Cloudflare, Nginx X-Real-IP, X-Forwarded-For)
    const candidate = headers['cf-connecting-ip'] ||
                      headers['true-client-ip'] ||
                      headers['x-real-ip'] ||
                      headers['x-forwarded-for'] ||
                      headers['x-client-ip'];

    if (candidate) {
        const firstIp = String(candidate).split(',')[0].trim();
        if (firstIp && !isLocalIp(firstIp)) {
            return cleanIp(firstIp);
        }
    }

    const raw = socket.handshake?.address || socket.conn?.remoteAddress || '127.0.0.1';
    return cleanIp(raw);
}

function handleVisitorSocket(io, socket) {
    if (typeof visitorService.setIo === 'function') {
        visitorService.setIo(io);
    }
    const visitorId = socket.handshake.auth?.visitorId || socket.handshake.query?.visitorId;

    // Clear any pending disconnect timeout if visitor reconnected quickly (e.g. page navigation)
    if (visitorId && disconnectTimeouts.has(visitorId)) {
        clearTimeout(disconnectTimeouts.get(visitorId));
        disconnectTimeouts.delete(visitorId);
    }

    // Join dedicated visitor room for direct targeted offers & alerts
    if (visitorId) {
        socket.join(`visitor_${visitorId}`);

        // If visitor has an unhandled pending custom offer, deliver it
        visitorService.getPendingOfferForVisitor(visitorId).then(offer => {
            if (offer) {
                socket.emit('custom_visitor_offer', {
                    _id: offer._id,
                    visitorId: offer.visitorId,
                    title: offer.title,
                    message: offer.message,
                    buttonText: offer.buttonText,
                    buttonUrl: offer.buttonUrl,
                    delaySeconds: offer.delaySeconds,
                    createdAt: offer.createdAt
                });
            }
        }).catch(err => {
            console.error('[Socket getPendingOffer Error]:', err.message);
        });
    }

    // 1. Admin joins the real-time live visitors monitor
    socket.on('join_visitor_monitor', () => {
        socket.join('admin_visitors_monitor');
        // Immediately send current live stream snapshot
        socket.emit('live_shoppers_stream', visitorService.getLiveShoppers());
    });

    socket.on('leave_visitor_monitor', () => {
        socket.leave('admin_visitors_monitor');
    });

    // 2. Client Page Navigation / Activity
    socket.on('visitor_activity', async (payload = {}) => {
        try {
            const vid = payload.visitorId || visitorId;
            if (!vid) return;

            const session = await visitorService.recordActivity({
                ...payload,
                visitorId: vid,
                ip: getClientIpFromSocket(socket),
                userAgent: socket.handshake.headers['user-agent'] || ''
            });

            // Broadcast live snapshot to admin monitor
            const liveList = visitorService.getLiveShoppers();
            io.to('admin_visitors_monitor').emit('live_shoppers_stream', liveList);
            io.emit('unique_visitors_count', liveList.length);
        } catch (err) {
            console.error('[Socket visitor_activity Error]:', err.message);
        }
    });

    // 3. Heartbeat / Time Tracking ping
    socket.on('visitor_heartbeat', (payload = {}) => {
        const vid = payload.visitorId || visitorId;
        if (!vid) return;

        visitorService.recordHeartbeat(vid, payload);
        // Throttle/emit live stream update
        io.to('admin_visitors_monitor').emit('live_shoppers_stream', visitorService.getLiveShoppers());
    });

    // 4. Cart Update (Real-time cart tracking & abandonment detection)
    socket.on('visitor_cart_update', async (payload = {}) => {
        try {
            const vid = payload.visitorId || visitorId;
            if (!vid) return;

            await visitorService.recordActivity({
                visitorId: vid,
                eventType: payload.cart?.length > 0 ? 'add_to_cart' : 'remove_from_cart',
                url: payload.url || '/cart',
                title: payload.cart?.length > 0 ? 'Updated Cart' : 'Emptied Cart',
                cart: payload.cart || [],
                cartTotal: payload.cartTotal || 0,
                hasCart: Boolean(payload.cart?.length > 0),
                eventMetadata: { itemsCount: payload.cart?.length || 0 }
            });

            io.to('admin_visitors_monitor').emit('live_shoppers_stream', visitorService.getLiveShoppers());
        } catch (err) {
            console.error('[Socket visitor_cart_update Error]:', err.message);
        }
    });

    // 5. Customer Profile Identification (Typing phone / name on checkout)
    socket.on('visitor_identify', async (profile = {}) => {
        try {
            const vid = profile.visitorId || visitorId;
            if (!vid) return;

            const session = await visitorService.identifyCustomer(vid, profile);

            // Broadcast identified customer to admins
            io.to('admin_visitors_monitor').emit('live_shoppers_stream', visitorService.getLiveShoppers());
            if (session && profile.phone) {
                io.to('admin_visitors_monitor').emit('customer_identified_alert', {
                    visitorId: vid,
                    dailySerial: session.dailySerial,
                    phone: profile.phone,
                    name: profile.fullName || session.customerName,
                    address: profile.address || session.customerAddress,
                    cartTotal: session.cartTotal
                });
            }
        } catch (err) {
            console.error('[Socket visitor_identify Error]:', err.message);
        }
    });

    // 6. Handle customer interaction with custom offer
    socket.on('visitor_offer_action', async ({ offerId, action } = {}) => {
        try {
            if (!offerId) return;
            await visitorService.recordOfferAction(offerId, action);
        } catch (err) {
            console.error('[Socket visitor_offer_action Error]:', err.message);
        }
    });

    // 7. Handle Disconnect with sliding window grace period
    socket.on('disconnect', () => {
        if (!visitorId) return;

        // Set a 15-second grace period before declaring visitor inactive
        const timeout = setTimeout(() => {
            disconnectTimeouts.delete(visitorId);
            const liveList = visitorService.getLiveShoppers();
            io.to('admin_visitors_monitor').emit('live_shoppers_stream', liveList);
            io.emit('unique_visitors_count', liveList.length);
        }, 15000);

        disconnectTimeouts.set(visitorId, timeout);
    });
}

module.exports = {
    handleVisitorSocket
};
