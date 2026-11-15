const { VisitorSession, VisitorEvent } = require('./visitor.model');
const OfferTemplate = require('./offerTemplate.model');
const VisitorCustomOffer = require('./visitorCustomOffer.model');
const Product = require('../product/product.model');

// In-memory real-time active visitors map for 0-delay live stream
const liveShoppers = new Map();

// Helper to get today's date in Asia/Dhaka (Bangladesh Standard Time)
function getDhakaDateString(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
}

// Simple parser for User-Agent
function parseUserAgent(ua = '') {
    const s = String(ua).toLowerCase();
    let device = 'Desktop';
    if (/mobile|android|iphone|ipad|ipod|blackberry|opera mini|iemobile|wpdesktop/i.test(s)) {
        device = /ipad|tablet/i.test(s) ? 'Tablet' : 'Mobile';
    }

    let browser = 'Unknown';
    if (s.includes('edg/')) browser = 'Edge';
    else if (s.includes('chrome/') || s.includes('crios/')) browser = 'Chrome';
    else if (s.includes('firefox/') || s.includes('fxios/')) browser = 'Firefox';
    else if (s.includes('safari/') && !s.includes('chrome/')) browser = 'Safari';
    else if (s.includes('opr/') || s.includes('opera/')) browser = 'Opera';

    let os = 'Unknown';
    if (s.includes('windows')) os = 'Windows';
    else if (s.includes('android')) os = 'Android';
    else if (s.includes('iphone') || s.includes('ipad') || s.includes('ios')) os = 'iOS';
    else if (s.includes('macintosh') || s.includes('mac os')) os = 'macOS';
    else if (s.includes('linux')) os = 'Linux';

    return { device, browser, os };
}

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

function extractClientIp(req = null, explicitIp = null) {
    if (explicitIp && !isLocalIp(explicitIp)) {
        return cleanIp(explicitIp);
    }

    if (req) {
        const headers = req.headers || {};
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
        if (req.ip && !isLocalIp(req.ip)) {
            return cleanIp(req.ip);
        }
        if (req.socket?.remoteAddress && !isLocalIp(req.socket.remoteAddress)) {
            return cleanIp(req.socket.remoteAddress);
        }
    }

    return cleanIp(explicitIp || '127.0.0.1');
}

class VisitorService {
    /**
     * Set Socket.io instance
     */
    setIo(io) {
        this.io = io;
    }

    /**
     * Broadcast live activity event to admin monitor room
     */
    broadcastActivityEvent(eventDoc, session) {
        try {
            let ioInstance = this.io;
            if (!ioInstance) {
                const socketConfig = require('../../socket');
                ioInstance = socketConfig.getIo();
            }
            if (ioInstance && eventDoc) {
                ioInstance.to('admin_visitors_monitor').emit('visitor_activity_event', {
                    _id: eventDoc._id,
                    visitorId: eventDoc.visitorId,
                    dailySerial: session?.dailySerial,
                    eventType: eventDoc.eventType,
                    url: eventDoc.url,
                    title: eventDoc.title,
                    metadata: eventDoc.metadata || {},
                    timestamp: eventDoc.timestamp || new Date(),
                    customerName: session?.customerName,
                    customerPhone: session?.customerPhone,
                    customerAddress: session?.customerAddress,
                    hasCart: session?.hasCart,
                    cartTotal: session?.cartTotal,
                    cartItems: session?.cartItems,
                    isOrderPlaced: session?.isOrderPlaced,
                    placedOrderId: session?.placedOrderId,
                    placedOrderAmount: session?.placedOrderAmount
                });
            }
        } catch (err) {
            // non-blocking
        }
    }

    /**
     * Get in-memory live shoppers list
     */
    getLiveShoppers() {
        const now = Date.now();
        const activeList = [];
        const windowMs = 35000; // 35 seconds window for active presence

        for (const [vid, item] of liveShoppers.entries()) {
            if (now - item.lastSeenTimestamp <= windowMs) {
                activeList.push({
                    ...item,
                    secondsAgo: Math.round((now - item.lastSeenTimestamp) / 1000)
                });
            } else {
                // Cleanup stale
                liveShoppers.delete(vid);
            }
        }

        return activeList.sort((a, b) => {
            const serialA = Number(a.dailySerial || 0);
            const serialB = Number(b.dailySerial || 0);
            if (serialB !== serialA) return serialB - serialA;
            const timeA = a.firstSeenAt ? new Date(a.firstSeenAt).getTime() : 0;
            const timeB = b.firstSeenAt ? new Date(b.firstSeenAt).getTime() : 0;
            if (timeB !== timeA) return timeB - timeA;
            return String(b.visitorId || '').localeCompare(String(a.visitorId || ''));
        });
    }

    /**
     * Record visitor activity (via Socket.io or HTTP beacon)
     */
    async recordActivity(payload, req = null) {
        try {
            const visitorId = String(payload.visitorId || '').trim();
            if (!visitorId || visitorId.length < 5) return null;

            const today = getDhakaDateString();
            const now = new Date();
            const nowMs = now.getTime();

            const ip = extractClientIp(req, payload.ip);
            const userAgent = payload.userAgent || req?.headers['user-agent'] || '';
            const { device, browser, os } = parseUserAgent(userAgent);

            const url = String(payload.url || '/').substring(0, 300);
            const title = String(payload.title || 'Storefront').substring(0, 200);
            const referrer = String(payload.referrer || '').substring(0, 300);

            const hasCart = Boolean(payload.cart?.length > 0 || payload.hasCart);
            let cartItems = Array.isArray(payload.cart) ? payload.cart.map(c => {
                const itemPrice = Number(
                    c.price ??
                    c.currentPrice ??
                    c.salePrice ??
                    c.basePrice ??
                    (c.total && c.quantity ? Number(c.total) / Number(c.quantity) : null) ??
                    c.product?.currentPrice ??
                    c.product?.price ??
                    0
                );
                return {
                    productId: c.productId || c._id || '',
                    slug: c.slug || c.product?.slug || '',
                    title: c.title || c.name || c.product?.title || 'Item',
                    image: c.image || c.featuredImage || c.product?.featuredImage || '',
                    price: itemPrice,
                    quantity: Number(c.quantity || 1),
                    variant: c.variant || ''
                };
            }) : [];

            // If any item has 0 price, lookup Product database as fallback
            if (cartItems.length > 0 && cartItems.some(i => i.price === 0)) {
                try {
                    const idsToLookup = cartItems.filter(i => i.price === 0 && i.productId).map(i => i.productId);
                    if (idsToLookup.length > 0) {
                        const dbProducts = await Product.find({ _id: { $in: idsToLookup } }).select('_id basePrice variants salePrice currentPrice price').lean();
                        const pMap = new Map(dbProducts.map(p => [String(p._id), p]));
                        for (const it of cartItems) {
                            if (it.price === 0 && it.productId) {
                                const found = pMap.get(String(it.productId));
                                if (found) {
                                    it.price = Number(found.variants?.[0]?.currentPrice || found.currentPrice || found.salePrice || found.basePrice || found.price || 0);
                                }
                            }
                        }
                    }
                } catch (e) {
                    // non-blocking fallback
                }
            }

            const cartTotal = Number(payload.cartTotal) > 0 
                ? Number(payload.cartTotal) 
                : cartItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);

            const visitedCheckout = url.includes('/checkout') || Boolean(payload.visitedCheckout);

            // Find existing session for today
            let session = await VisitorSession.findOne({ visitorId, sessionDate: today });

            if (!session) {
                // Check if returning visitor (visited prior to today)
                const priorSession = await VisitorSession.findOne({
                    visitorId,
                    sessionDate: { $lt: today }
                }).select('_id');

                const isReturning = Boolean(priorSession);

                // Calculate daily sequential serial #1, #2, #3 for today
                const highestSerialDoc = await VisitorSession.findOne({ sessionDate: today })
                    .sort({ dailySerial: -1 })
                    .select('dailySerial');
                const dailySerial = (highestSerialDoc?.dailySerial || 0) + 1;

                session = new VisitorSession({
                    visitorId,
                    dailySerial,
                    sessionDate: today,
                    ip,
                    device,
                    browser,
                    os,
                    referrer,
                    entryUrl: url,
                    lastUrl: url,
                    lastTitle: title,
                    pageViewsCount: 1,
                    durationSeconds: 0,
                    isReturning,
                    hasCart,
                    cartItems,
                    cartTotal,
                    visitedCheckout,
                    customerName: payload.customerName || null,
                    customerPhone: payload.customerPhone || null,
                    customerAddress: payload.customerAddress || null,
                    customerNotes: payload.customerNotes || payload.notes || null,
                    deliveryCharge: Number(payload.deliveryCharge || 0),
                    checkoutInfoHistory: (payload.customerPhone || payload.customerName) ? [{
                        name: payload.customerName || '',
                        phone: payload.customerPhone || '',
                        address: payload.customerAddress || '',
                        notes: payload.customerNotes || payload.notes || '',
                        capturedAt: now
                    }] : [],
                    userId: payload.userId || null,
                    firstSeenAt: now,
                    lastSeenAt: now
                });
            } else {
                // Update session
                session.pageViewsCount += 1;
                session.lastUrl = url;
                session.lastTitle = title;
                session.lastSeenAt = now;
                if (isLocalIp(session.ip) && !isLocalIp(ip)) {
                    session.ip = ip;
                }
                if (hasCart) {
                    session.hasCart = true;
                    session.cartItems = cartItems;
                    session.cartTotal = cartTotal;
                } else if (payload.cartTotal !== undefined && Number(payload.cartTotal) > 0) {
                    session.cartTotal = Number(payload.cartTotal);
                }
                if (visitedCheckout) {
                    session.visitedCheckout = true;
                }
                if (payload.customerPhone) {
                    session.customerPhone = payload.customerPhone;
                }
                if (payload.customerName) {
                    session.customerName = payload.customerName;
                }
                if (payload.customerAddress) {
                    session.customerAddress = payload.customerAddress;
                }
                if (payload.customerNotes || payload.notes) {
                    session.customerNotes = payload.customerNotes || payload.notes;
                }
                if (payload.deliveryCharge !== undefined) {
                    session.deliveryCharge = Number(payload.deliveryCharge);
                }
                if (payload.userId && !session.userId) {
                    session.userId = payload.userId;
                }

                // Update duration
                const duration = Math.round((now.getTime() - new Date(session.firstSeenAt).getTime()) / 1000);
                if (duration > session.durationSeconds) {
                    session.durationSeconds = duration;
                }
            }

            await session.save();

            // Log Footprint Journey Event
            let eventType = 'page_view';
            if (url.includes('/product/')) eventType = 'product_view';
            if (url.includes('/checkout')) eventType = 'checkout_step';
            if (payload.eventType) eventType = payload.eventType;

            const eventDoc = await VisitorEvent.create({
                visitorSessionId: session._id,
                visitorId,
                sessionDate: today,
                eventType,
                url,
                title,
                metadata: {
                    device,
                    hasCart,
                    cartCount: cartItems.length,
                    cartTotal,
                    ...(payload.eventMetadata || {})
                },
                timestamp: now
            });

            this.broadcastActivityEvent(eventDoc, session);

            // Update in-memory live shoppers map
            const existingMemory = liveShoppers.get(visitorId) || {};
            const resolvedIp = !isLocalIp(ip) ? ip : (!isLocalIp(existingMemory.ip) ? existingMemory.ip : (session.ip || ip));
            liveShoppers.set(visitorId, {
                visitorId,
                dailySerial: session.dailySerial,
                sessionId: session._id,
                ip: resolvedIp,
                device,
                browser,
                os,
                url,
                title,
                entryUrl: session.entryUrl,
                firstSeenAt: session.firstSeenAt,
                lastSeenTimestamp: nowMs,
                durationSeconds: session.durationSeconds,
                hasCart: session.hasCart,
                cartItems: session.cartItems,
                cartTotal: session.cartTotal,
                visitedCheckout: session.visitedCheckout,
                customerName: session.customerName,
                customerPhone: session.customerPhone,
                customerAddress: session.customerAddress,
                customerNotes: session.customerNotes,
                checkoutInfoHistory: session.checkoutInfoHistory || [],
                deliveryCharge: session.deliveryCharge || 0,
                pageViewsCount: session.pageViewsCount,
                isReturning: session.isReturning,
                isOrderPlaced: session.isOrderPlaced || existingMemory.isOrderPlaced || false,
                placedOrderId: session.placedOrderId || existingMemory.placedOrderId || null,
                placedOrderAmount: session.placedOrderAmount || existingMemory.placedOrderAmount || 0
            });

            return session;
        } catch (err) {
            console.error('[VisitorService.recordActivity Error]:', err.message);
            return null;
        }
    }

    /**
     * Heartbeat ping (updates duration and live state without logging page view)
     */
    async recordHeartbeat(visitorId, payload = {}) {
        try {
            if (!visitorId) return;
            const now = new Date();
            const nowMs = now.getTime();
            const today = getDhakaDateString();

            let mem = liveShoppers.get(visitorId);
            if (!mem) {
                const session = await VisitorSession.findOne({ visitorId, sessionDate: today });
                if (session) {
                    mem = {
                        visitorId,
                        dailySerial: session.dailySerial,
                        sessionId: session._id,
                        ip: session.ip || '127.0.0.1',
                        device: session.device,
                        browser: session.browser,
                        os: session.os,
                        url: payload.url || session.lastUrl,
                        title: payload.title || session.lastTitle,
                        entryUrl: session.entryUrl,
                        firstSeenAt: session.firstSeenAt,
                        lastSeenTimestamp: nowMs,
                        durationSeconds: session.durationSeconds,
                        hasCart: session.hasCart,
                        cartItems: session.cartItems || [],
                        cartTotal: session.cartTotal || 0,
                        visitedCheckout: session.visitedCheckout,
                        customerName: session.customerName,
                        customerPhone: session.customerPhone,
                        customerAddress: session.customerAddress,
                        customerNotes: session.customerNotes,
                        checkoutInfoHistory: session.checkoutInfoHistory || [],
                        deliveryCharge: session.deliveryCharge || 0,
                        pageViewsCount: session.pageViewsCount,
                        isReturning: session.isReturning,
                        isOrderPlaced: session.isOrderPlaced || false,
                        placedOrderId: session.placedOrderId || null,
                        placedOrderAmount: session.placedOrderAmount || 0
                    };
                    liveShoppers.set(visitorId, mem);
                }
            }
            if (mem) {
                mem.lastSeenTimestamp = nowMs;
                if (payload.url) mem.url = payload.url;
                if (payload.title) mem.title = payload.title;

                // Protect cartTotal from being erroneously overwritten by 0
                if (payload.cartTotal !== undefined && Number(payload.cartTotal) > 0) {
                    mem.cartTotal = Number(payload.cartTotal);
                } else if (mem.cartItems && mem.cartItems.length > 0 && (!mem.cartTotal || mem.cartTotal === 0)) {
                    mem.cartTotal = mem.cartItems.reduce((s, i) => s + (Number(i.price || 0) * Number(i.quantity || 1)), 0);
                }

                if (payload.hasCart !== undefined) mem.hasCart = Boolean(payload.hasCart);
                if (payload.customerPhone) mem.customerPhone = payload.customerPhone;
                if (payload.customerName) mem.customerName = payload.customerName;

                const duration = Math.round((nowMs - new Date(mem.firstSeenAt).getTime()) / 1000);
                mem.durationSeconds = duration;
            }

            // Periodically sync duration to DB
            await VisitorSession.updateOne(
                { visitorId, sessionDate: today },
                {
                    $set: {
                        lastSeenAt: now,
                        ...(mem ? { durationSeconds: mem.durationSeconds } : {})
                    }
                }
            );
        } catch (err) {
            // Non-blocking fail-safe
        }
    }

    /**
     * Identify customer pre-order (e.g. typing phone / name / address / notes on checkout)
     * Enforces valid 11-digit mobile numbers and intelligently merges incremental typing.
     */
    async identifyCustomer(visitorId, profileData = {}) {
        try {
            if (!visitorId) return null;
            const today = getDhakaDateString();
            const now = new Date();
            const { phone, fullName, address, userId, notes, customerNotes, deliveryCharge, cartTotal } = profileData;

            // Strict 11-digit Bangladeshi mobile number validation (013-019)
            const rawPhoneDigits = phone ? String(phone).replace(/\D/g, '') : '';
            const isValid11DigitPhone = /^01[3-9]\d{8}$/.test(rawPhoneDigits);
            const cleanPhone = isValid11DigitPhone ? rawPhoneDigits : null;

            const cleanName = fullName && String(fullName).trim().length >= 2 ? String(fullName).trim() : null;
            const cleanAddress = address && String(address).trim().length >= 5 ? String(address).trim() : null;
            const cleanNotes = (notes || customerNotes) ? String(notes || customerNotes).trim() : null;

            let session = await VisitorSession.findOne({ visitorId, sessionDate: today });
            if (!session) {
                session = await VisitorSession.findOne({ visitorId }).sort({ createdAt: -1 });
            }

            if (session) {
                if (cleanPhone) session.customerPhone = cleanPhone;
                if (cleanName) session.customerName = cleanName;
                if (cleanAddress) session.customerAddress = cleanAddress;
                if (cleanNotes) session.customerNotes = cleanNotes;
                if (userId) session.userId = userId;
                if (deliveryCharge !== undefined) session.deliveryCharge = Number(deliveryCharge);
                if (cartTotal && Number(cartTotal) > 0) session.cartTotal = Number(cartTotal);

                if (!session.checkoutInfoHistory) session.checkoutInfoHistory = [];

                // Filter out any legacy invalid phone entries (< 11 digits) from history
                session.checkoutInfoHistory = session.checkoutInfoHistory.filter(h => {
                    if (h.phone && h.phone.length !== 11) return false;
                    return true;
                });

                // Strictly only record history if valid 11-digit phone or substantial address is present
                const hasValidPhone = Boolean(cleanPhone && cleanPhone.length === 11);
                const hasSubstantialAddr = Boolean(cleanAddress && cleanAddress.length >= 6);

                if (hasValidPhone || hasSubstantialAddr) {
                    const history = session.checkoutInfoHistory;
                    const last = history.length > 0 ? history[history.length - 1] : null;

                    const nowMs = now.getTime();
                    const lastMs = last?.capturedAt ? new Date(last.capturedAt).getTime() : 0;
                    const isWithin3Min = (nowMs - lastMs) < (1000 * 60 * 3);

                    if (!last) {
                        // First entry
                        session.checkoutInfoHistory.push({
                            name: cleanName || session.customerName || '',
                            phone: cleanPhone || '',
                            address: cleanAddress || '',
                            notes: cleanNotes || '',
                            capturedAt: now
                        });
                    } else {
                        const lastPhone = last.phone || '';
                        const currentPhone = cleanPhone || '';

                        // If user changed to a different 11-digit phone number
                        const isPhoneChanged = currentPhone && lastPhone && currentPhone !== lastPhone;
                        
                        // Check if address is continuing/incremental typing or completely different
                        const lastAddr = (last.address || '').toLowerCase().trim();
                        const currAddr = (cleanAddress || '').toLowerCase().trim();
                        const isIncrementalAddr = lastAddr && currAddr && (currAddr.includes(lastAddr) || lastAddr.includes(currAddr));
                        const isAddrChanged = currAddr && lastAddr && !isIncrementalAddr && currAddr !== lastAddr;

                        if (isPhoneChanged || isAddrChanged) {
                            // Genuine new revision (customer replaced phone or completely changed address)
                            session.checkoutInfoHistory.push({
                                name: cleanName || session.customerName || '',
                                phone: currentPhone || lastPhone,
                                address: cleanAddress || last.address || '',
                                notes: cleanNotes || last.notes || '',
                                capturedAt: now
                            });
                        } else {
                            // User is continuing to type/edit address or name under same phone
                            if (cleanName) last.name = cleanName;
                            if (currentPhone) last.phone = currentPhone;
                            if (cleanAddress) last.address = cleanAddress;
                            if (cleanNotes) last.notes = cleanNotes;
                            last.capturedAt = now;
                        }
                    }
                }

                await session.save();
            }

            // Update in-memory live shoppers cache
            const mem = liveShoppers.get(visitorId);
            if (mem) {
                if (cleanPhone) mem.customerPhone = cleanPhone;
                if (cleanName) mem.customerName = cleanName;
                if (cleanAddress) mem.customerAddress = cleanAddress;
                if (cleanNotes) mem.customerNotes = cleanNotes;
                if (deliveryCharge !== undefined) mem.deliveryCharge = Number(deliveryCharge);
                if (cartTotal && Number(cartTotal) > 0) mem.cartTotal = Number(cartTotal);
                if (session && session.checkoutInfoHistory) {
                    mem.checkoutInfoHistory = session.checkoutInfoHistory;
                }
            }

            // Log event only if 11-digit valid phone or name was identified
            if (session && (cleanPhone || cleanName)) {
                const eventDoc = await VisitorEvent.create({
                    visitorSessionId: session._id,
                    visitorId,
                    sessionDate: session.sessionDate || today,
                    eventType: 'profile_identified',
                    url: session.lastUrl || '/checkout',
                    title: 'Identified Contact Profile',
                    metadata: {
                        phone: cleanPhone,
                        fullName: cleanName,
                        address: cleanAddress,
                        notes: cleanNotes
                    },
                    timestamp: now
                });

                this.broadcastActivityEvent(eventDoc, session);
            }

            return session;
        } catch (err) {
            console.error('[VisitorService.identifyCustomer Error]:', err.message);
            return null;
        }
    }

    /**
     * Get or seed default offer templates
     */
    async getOfferTemplates() {
        let templates = await OfferTemplate.find().sort({ createdAt: -1 });
        if (templates.length === 0) {
            const defaults = [
                {
                    name: 'ফ্রি ডেলিভারি অফার (Free Delivery)',
                    title: 'আজকের জন্য বিশেষ ফ্রি হোম ডেলিভারি!',
                    message: 'প্রিয় গ্রাহক, এখনই আপনার অর্ডারটি কনফার্ম করুন আর উপভোগ করুন সারা বাংলাদেশে সম্পূর্ণ ফ্রি হোম ডেলিভারি!',
                    buttonText: 'অর্ডার সম্পন্ন করুন',
                    buttonUrl: '/checkout',
                    delaySeconds: 0
                },
                {
                    name: '১০০ টাকা ইনস্ট্যান্ট ছাড়',
                    title: 'আপনার জন্য স্পেশাল ৳১০০ ডিসকাউন্ট!',
                    message: 'কার্ট খালি না রেখে এখনই চেকআউট করুন, পাচ্ছেন ইনস্ট্যান্ট ১০০ টাকা বিশেষ মূল্যছাড়!',
                    buttonText: 'অফারটি লুফে নিন',
                    buttonUrl: '/checkout',
                    delaySeconds: 5
                },
                {
                    name: 'সহজ চেকআউট হেল্প (Cart Help)',
                    title: 'অর্ডার করতে কোনো সমস্যা হচ্ছে?',
                    message: 'আমরা আপনাকে সাহায্য করতে প্রস্তুত! যেকোনো প্রশ্নে মেসেজ করুন অথবা এক ক্লিকে সহজ চেকআউট সম্পন্ন করুন।',
                    buttonText: 'চেকআউটে যান',
                    buttonUrl: '/checkout',
                    delaySeconds: 10
                }
            ];
            templates = await OfferTemplate.insertMany(defaults);
        }
        return templates;
    }

    async createOfferTemplate(data) {
        return await OfferTemplate.create(data);
    }

    async updateOfferTemplate(id, data) {
        return await OfferTemplate.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    }

    async deleteOfferTemplate(id) {
        return await OfferTemplate.findByIdAndDelete(id);
    }

    /**
     * Dispatch Custom Offer to a visitor (Live via Socket + Persisted in DB)
     */
    async sendCustomOffer(payload = {}) {
        const {
            visitorId,
            customerPhone,
            customerName,
            title,
            message,
            buttonText = 'অর্ডার সম্পন্ন করুন',
            buttonUrl = '/checkout',
            delaySeconds = 0,
            adminName = 'Admin',
            templateId = null
        } = payload;

        if (!visitorId) throw new Error('Visitor ID is required to send offer');
        if (!title || !message) throw new Error('Title and message are required');

        // Dismiss previous pending offers for this visitor to avoid duplicate stacked popups
        await VisitorCustomOffer.updateMany(
            { visitorId, status: 'pending' },
            { status: 'dismissed', actionAt: new Date() }
        );

        const offer = await VisitorCustomOffer.create({
            visitorId,
            customerPhone: customerPhone || null,
            customerName: customerName || null,
            title,
            message,
            buttonText,
            buttonUrl,
            delaySeconds: Number(delaySeconds) || 0,
            adminName,
            templateId: templateId || null,
            status: 'pending'
        });

        // Find session to log event in timeline and broadcast
        const today = getDhakaDateString();
        let session = await VisitorSession.findOne({ visitorId, sessionDate: today });
        if (!session) {
            session = await VisitorSession.findOne({ visitorId }).sort({ createdAt: -1 });
        }

        try {
            const eventDoc = await VisitorEvent.create({
                visitorSessionId: session ? session._id : null,
                visitorId,
                sessionDate: session?.sessionDate || today,
                eventType: 'offer_sent',
                url: buttonUrl || '/checkout',
                title: `Sent Custom Offer: "${title}"`,
                metadata: {
                    offerId: offer._id,
                    title: offer.title,
                    message: offer.message,
                    buttonText: offer.buttonText,
                    buttonUrl: offer.buttonUrl,
                    delaySeconds: offer.delaySeconds,
                    adminName: offer.adminName
                },
                timestamp: new Date()
            });

            this.broadcastActivityEvent(eventDoc, session);
        } catch (eventErr) {
            console.warn('[VisitorService.sendCustomOffer] Event log notice:', eventErr.message);
        }

        // Broadcast to visitor via Socket.io
        try {
            const socketConfig = require('../../socket');
            const io = socketConfig.getIo();
            if (io) {
                // Emit to visitor's dedicated room
                io.to(`visitor_${visitorId}`).emit('custom_visitor_offer', {
                    _id: offer._id,
                    visitorId: offer.visitorId,
                    title: offer.title,
                    message: offer.message,
                    buttonText: offer.buttonText,
                    buttonUrl: offer.buttonUrl,
                    delaySeconds: offer.delaySeconds,
                    createdAt: offer.createdAt
                });

                // Also notify admin monitor room
                io.to('admin_visitors_monitor').emit('admin_offer_dispatched', {
                    offerId: offer._id,
                    visitorId: offer.visitorId,
                    customerPhone: offer.customerPhone,
                    title: offer.title,
                    adminName: offer.adminName
                });
            }
        } catch (socketErr) {
            console.warn('[VisitorService.sendCustomOffer] Socket emit notice:', socketErr.message);
        }

        return offer;
    }

    /**
     * Get pending offer for a visitor (e.g. when landing on site or offline previously)
     */
    async getPendingOfferForVisitor(visitorId) {
        if (!visitorId) return null;
        const offer = await VisitorCustomOffer.findOne({
            visitorId,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        return offer;
    }

    /**
     * Update offer action (clicked or dismissed by customer)
     */
    async recordOfferAction(offerId, action = 'clicked') {
        const isAccepted = action === 'clicked' || action === 'accepted';
        const validAction = isAccepted ? 'clicked' : 'dismissed';

        // Check if offer was already actioned (e.g. concurrent socket + REST call) to avoid duplicate events
        const existing = await VisitorCustomOffer.findById(offerId);
        if (!existing) return null;
        if (existing.status !== 'pending') {
            return existing;
        }

        const offer = await VisitorCustomOffer.findOneAndUpdate(
            { _id: offerId, status: 'pending' },
            { status: validAction, actionAt: new Date() },
            { new: true }
        );

        if (!offer) {
            return await VisitorCustomOffer.findById(offerId);
        }

        if (offer) {
            const today = getDhakaDateString();
            let session = await VisitorSession.findOne({ visitorId: offer.visitorId, sessionDate: today });
            if (!session) {
                session = await VisitorSession.findOne({ visitorId: offer.visitorId }).sort({ createdAt: -1 });
            }

            const eventTitle = isAccepted 
                ? `Accepted Offer: "${offer.title}"` 
                : `Dismissed / Closed Offer: "${offer.title}"`;
            const eventType = isAccepted ? 'offer_accepted' : 'offer_dismissed';

            try {
                const eventDoc = await VisitorEvent.create({
                    visitorSessionId: session ? session._id : null,
                    visitorId: offer.visitorId,
                    sessionDate: session?.sessionDate || today,
                    eventType,
                    url: offer.buttonUrl || '/',
                    title: eventTitle,
                    metadata: {
                        offerId: offer._id,
                        title: offer.title,
                        action: isAccepted ? 'accepted' : 'dismissed',
                        adminName: offer.adminName
                    },
                    timestamp: new Date()
                });

                this.broadcastActivityEvent(eventDoc, session);
            } catch (eventErr) {
                console.warn('[VisitorService.recordOfferAction] Event log notice:', eventErr.message);
            }

            try {
                const socketConfig = require('../../socket');
                const io = socketConfig.getIo();
                if (io) {
                    io.to('admin_visitors_monitor').emit('admin_offer_action', {
                        offerId: offer._id,
                        visitorId: offer.visitorId,
                        customerPhone: offer.customerPhone,
                        action: validAction,
                        title: offer.title
                    });
                }
            } catch (err) {}
        }

        return offer;
    }

    /**
     * Get list of dispatched offers history (supports optional visitorId filter)
     */
    async getOffersHistory(options = {}) {
        let limit = 50;
        let query = {};

        if (typeof options === 'object' && options !== null) {
            if (options.limit) limit = Number(options.limit) || 50;
            if (options.visitorId) query.visitorId = options.visitorId;
        } else if (typeof options === 'number') {
            limit = options;
        }

        return await VisitorCustomOffer.find(query).sort({ createdAt: -1 }).limit(limit);
    }

    /**
     * Mark an order as placed for a visitor session (both DB and live shoppers memory)
     */
    async markOrderPlaced(visitorIdOrPayload, orderIdArg, totalAmountArg = 0) {
        try {
            let visitorId = visitorIdOrPayload;
            let orderId = orderIdArg;
            let totalAmount = totalAmountArg;

            if (typeof visitorIdOrPayload === 'object' && visitorIdOrPayload !== null) {
                visitorId = visitorIdOrPayload.visitorId;
                orderId = visitorIdOrPayload.orderId || visitorIdOrPayload.placedOrderId;
                totalAmount = visitorIdOrPayload.total || visitorIdOrPayload.totalAmount || 0;
            }

            if (!visitorId) return;
            const today = getDhakaDateString();
            const now = new Date();

            // 1. Update VisitorSession in DB
            await VisitorSession.updateMany(
                { visitorId, sessionDate: today },
                {
                    $set: {
                        isOrderPlaced: true,
                        placedOrderId: String(orderId),
                        placedOrderAmount: Number(totalAmount),
                        hasCart: false,
                        lastSeenAt: now
                    }
                }
            );

            // 2. Log event in VisitorEvent
            const session = await VisitorSession.findOne({ visitorId, sessionDate: today });
            if (session) {
                const eventDoc = await VisitorEvent.create({
                    visitorSessionId: session._id,
                    visitorId,
                    sessionDate: today,
                    eventType: 'order_placed',
                    url: '/order-confirmation',
                    title: `Order #${orderId} Placed`,
                    metadata: {
                        orderId: String(orderId),
                        totalAmount: Number(totalAmount)
                    },
                    timestamp: now
                });

                this.broadcastActivityEvent(eventDoc, session);
            }

            // 3. Update in-memory liveShoppers
            const mem = liveShoppers.get(visitorId);
            if (mem) {
                mem.isOrderPlaced = true;
                mem.placedOrderId = String(orderId);
                mem.placedOrderAmount = Number(totalAmount);
                mem.hasCart = false;
            }

            // 4. Broadcast live stream update and alert to admin room
            try {
                const socketConfig = require('../../socket');
                const io = socketConfig.getIo();
                if (io) {
                    const activeList = this.getLiveShoppers();
                    io.to('admin_visitors_monitor').emit('live_shoppers_stream', activeList);
                    io.to('admin_visitors_monitor').emit('order_placed_alert', {
                        visitorId,
                        orderId: String(orderId),
                        totalAmount: Number(totalAmount),
                        placedAt: now
                    });
                }
            } catch (err) {}
        } catch (err) {
            console.error('[VisitorService.markOrderPlaced Error]:', err.message);
        }
    }
}

module.exports = new VisitorService();
