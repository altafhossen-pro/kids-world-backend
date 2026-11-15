const mongoose = require('mongoose');
const { VisitorSession, VisitorEvent } = require('./visitor.model');
require('../user/user.model');
const visitorService = require('./visitor.service');

// Helper to get today's date in Asia/Dhaka
function getDhakaDateString(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
}

class VisitorController {
    /**
     * Get historical visitor footprint sessions & metrics by date
     */
    async getFootprint(req, res) {
        try {
            const todayStr = getDhakaDateString();
            const range = req.query.range;
            const fromParam = (req.query.startDate || req.query.from || '').trim();
            const toParam = (req.query.endDate || req.query.to || '').trim();
            const singleDate = (req.query.date || '').trim();
            const visitorIdParam = (req.query.visitorId || '').trim();

            let dateCondition;
            let displayLabel = todayStr;

            if (range === 'last_7_days') {
                const d = new Date();
                d.setDate(d.getDate() - 6);
                const from7 = getDhakaDateString(d);
                dateCondition = { $gte: from7, $lte: todayStr };
                displayLabel = `${from7} - ${todayStr}`;
            } else if (range === 'last_30_days') {
                const d = new Date();
                d.setDate(d.getDate() - 29);
                const from30 = getDhakaDateString(d);
                dateCondition = { $gte: from30, $lte: todayStr };
                displayLabel = `${from30} - ${todayStr}`;
            } else if (fromParam && toParam) {
                const sDate = fromParam <= toParam ? fromParam : toParam;
                const eDate = fromParam <= toParam ? toParam : fromParam;
                dateCondition = { $gte: sDate, $lte: eDate };
                displayLabel = `${sDate} - ${eDate}`;
            } else if (fromParam) {
                dateCondition = { $gte: fromParam, $lte: todayStr };
                displayLabel = `From ${fromParam}`;
            } else if (singleDate) {
                dateCondition = singleDate;
                displayLabel = singleDate;
            } else {
                dateCondition = todayStr;
                displayLabel = todayStr;
            }

            const filter = req.query.filter || 'all';
            const search = (req.query.search || '').trim();
            const sort = req.query.sort || 'default';
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 25));
            const skip = (page - 1) * limit;

            const query = {};

            // If a specific visitorId or search query is looked up without explicit date bounds, search across all dates
            if (visitorIdParam) {
                query.visitorId = visitorIdParam;
            } else if (search && search.startsWith('visitor_')) {
                // If user pasted a visitor ID into search box, match across all dates
                query.visitorId = search;
            } else {
                query.sessionDate = dateCondition;
            }

            // Filters
            if (filter === 'returning') {
                query.isReturning = true;
            } else if (filter === 'with_cart') {
                query.hasCart = true;
            } else if (filter === 'checkout') {
                query.visitedCheckout = true;
            } else if (filter === 'identified') {
                query.$or = [
                    { customerPhone: { $ne: null } },
                    { customerName: { $ne: null } },
                    { userId: { $ne: null } }
                ];
            } else if (filter === 'abandoned') {
                query.hasCart = true;
                query.isOrderPlaced = false;
            }

            // General Search (phone, name, address, IP, title, URL)
            if (search && !search.startsWith('visitor_')) {
                const searchRegex = new RegExp(search, 'i');
                const searchConditions = [
                    { visitorId: searchRegex },
                    { customerName: searchRegex },
                    { customerPhone: searchRegex },
                    { customerAddress: searchRegex },
                    { ip: searchRegex },
                    { lastTitle: searchRegex },
                    { lastUrl: searchRegex }
                ];

                if (!isNaN(search)) {
                    searchConditions.push({ dailySerial: Number(search) });
                }

                if (query.$or) {
                    query.$and = [{ $or: query.$or }, { $or: searchConditions }];
                    delete query.$or;
                } else {
                    query.$or = searchConditions;
                }
            }

            // Sorting: Always prioritize newest/most active visitors on top by default
            let sortOptions;
            if (sort === 'oldest') {
                sortOptions = { firstSeenAt: 1 };
            } else if (sort === 'serial') {
                sortOptions = { dailySerial: 1 };
            } else {
                sortOptions = { lastSeenAt: -1 };
            }

            // Aggregate: Group by unique visitorId so 1 visitor = 1 row with consolidated visit metrics
            const pipeline = [
                { $match: query },
                { $sort: { lastSeenAt: -1 } },
                {
                    $group: {
                        _id: '$visitorId',
                        sessionId: { $first: '$_id' },
                        visitorId: { $first: '$visitorId' },
                        dailySerial: { $first: '$dailySerial' },
                        sessionDate: { $first: '$sessionDate' },
                        ip: { $first: '$ip' },
                        device: { $first: '$device' },
                        browser: { $first: '$browser' },
                        os: { $first: '$os' },
                        entryUrl: { $last: '$entryUrl' },
                        lastUrl: { $first: '$lastUrl' },
                        lastTitle: { $first: '$lastTitle' },
                        pageViewsCount: { $sum: '$pageViewsCount' },
                        durationSeconds: { $sum: '$durationSeconds' },
                        hasCart: { $first: '$hasCart' },
                        cartItems: { $first: '$cartItems' },
                        cartTotal: { $first: '$cartTotal' },
                        visitedCheckout: { $first: '$visitedCheckout' },
                        isOrderPlaced: { $first: '$isOrderPlaced' },
                        placedOrderId: { $first: '$placedOrderId' },
                        placedOrderAmount: { $first: '$placedOrderAmount' },
                        customerName: { $first: '$customerName' },
                        customerPhone: { $first: '$customerPhone' },
                        customerAddress: { $first: '$customerAddress' },
                        customerNotes: { $first: '$customerNotes' },
                        checkoutInfoHistory: { $first: '$checkoutInfoHistory' },
                        deliveryCharge: { $first: '$deliveryCharge' },
                        userId: { $first: '$userId' },
                        firstSeenAt: { $min: '$firstSeenAt' },
                        lastSeenAt: { $max: '$lastSeenAt' },
                        datesVisited: { $addToSet: '$sessionDate' }
                    }
                },
                {
                    $addFields: {
                        totalDaysCount: { $size: '$datesVisited' },
                        isReturning: {
                            $or: [
                                { $gt: [{ $size: '$datesVisited' }, 1] },
                                { $eq: ['$isReturning', true] }
                            ]
                        }
                    }
                },
                {
                    $facet: {
                        paginatedResults: [
                            { $sort: sortOptions },
                            { $skip: skip },
                            { $limit: limit },
                            {
                                $lookup: {
                                    from: 'users',
                                    localField: 'userId',
                                    foreignField: '_id',
                                    as: 'userId'
                                }
                            },
                            {
                                $unwind: {
                                    path: '$userId',
                                    preserveNullAndEmptyArrays: true
                                }
                            }
                        ],
                        totalCount: [
                            { $count: 'count' }
                        ]
                    }
                }
            ];

            const [aggregationResult] = await VisitorSession.aggregate(pipeline);
            const sessions = aggregationResult?.paginatedResults || [];
            const total = aggregationResult?.totalCount?.[0]?.count || 0;

            // Compute overall summary metrics for the selected date condition
            const metricsPipeline = [
                { $match: { sessionDate: dateCondition } },
                {
                    $group: {
                        _id: null,
                        totalVisitors: { $addToSet: '$visitorId' },
                        totalPageViews: { $sum: '$pageViewsCount' },
                        totalDuration: { $sum: '$durationSeconds' },
                        cartVisitors: {
                            $addToSet: {
                                $cond: [{ $eq: ['$hasCart', true] }, '$visitorId', '$$REMOVE']
                            }
                        },
                        checkoutVisitors: {
                            $addToSet: {
                                $cond: [{ $eq: ['$visitedCheckout', true] }, '$visitorId', '$$REMOVE']
                            }
                        },
                        identifiedVisitors: {
                            $addToSet: {
                                $cond: [
                                    {
                                        $or: [
                                            { $ne: ['$customerPhone', null] },
                                            { $ne: ['$customerName', null] }
                                        ]
                                    },
                                    '$visitorId',
                                    '$$REMOVE'
                                ]
                            }
                        },
                        returningVisitors: {
                            $addToSet: {
                                $cond: [{ $eq: ['$isReturning', true] }, '$visitorId', '$$REMOVE']
                            }
                        }
                    }
                }
            ];

            const [metricsSummary] = await VisitorSession.aggregate(metricsPipeline);

            const totalVisitors = metricsSummary?.totalVisitors?.length || 0;
            const totalPageViews = metricsSummary?.totalPageViews || 0;
            const cartVisitors = metricsSummary?.cartVisitors?.length || 0;
            const checkoutVisitors = metricsSummary?.checkoutVisitors?.length || 0;
            const identifiedVisitors = metricsSummary?.identifiedVisitors?.length || 0;
            const returningCount = metricsSummary?.returningVisitors?.length || 0;
            const avgDurationSeconds = totalVisitors > 0
                ? Math.round((metricsSummary?.totalDuration || 0) / totalVisitors)
                : 0;

            return res.status(200).json({
                success: true,
                data: {
                    sessions,
                    pagination: {
                        total,
                        page,
                        limit,
                        totalPages: Math.ceil(total / limit) || 1
                    },
                    metrics: {
                        date: displayLabel,
                        dateCondition,
                        totalVisitors,
                        totalPageViews,
                        returningCount,
                        cartVisitors,
                        checkoutVisitors,
                        identifiedVisitors,
                        avgDurationSeconds
                    }
                }
            });
        } catch (error) {
            console.error('[VisitorController.getFootprint Error]:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch visitor footprint',
                error: error.message
            });
        }
    }

    /**
     * Get step-by-step journey timeline of a specific session or visitor (grouped date-wise)
     */
    async getSessionJourney(req, res) {
        try {
            const { id } = req.params;
            let visitorId = id;
            let targetSession = null;

            if (mongoose.Types.ObjectId.isValid(id)) {
                targetSession = await VisitorSession.findById(id)
                    .populate('userId', 'name email phone avatar')
                    .lean();
                if (targetSession) {
                    visitorId = targetSession.visitorId;
                }
            }

            // Find all sessions for this visitor across all dates
            const allSessions = await VisitorSession.find({ visitorId })
                .populate('userId', 'name email phone avatar')
                .sort({ sessionDate: -1, lastSeenAt: -1 })
                .lean();

            if (!targetSession && allSessions.length > 0) {
                targetSession = allSessions[0];
            }

            if (!targetSession && allSessions.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Visitor session not found'
                });
            }

            // Fetch all events for this visitor
            const events = await VisitorEvent.find({ visitorId })
                .sort({ timestamp: -1 })
                .lean();

            // Group events date-wise in chronological descending order
            const todayStr = getDhakaDateString();
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = getDhakaDateString(yesterday);

            const groupedMap = new Map();
            events.forEach(evt => {
                const dateKey = evt.sessionDate || getDhakaDateString(new Date(evt.timestamp));
                if (!groupedMap.has(dateKey)) {
                    let label = dateKey;
                    if (dateKey === todayStr) label = `Today (${dateKey})`;
                    else if (dateKey === yesterdayStr) label = `Yesterday (${dateKey})`;
                    else label = dateKey;

                    groupedMap.set(dateKey, {
                        date: dateKey,
                        label,
                        events: []
                    });
                }
                groupedMap.get(dateKey).events.push(evt);
            });

            const groupedDates = Array.from(groupedMap.values());

            return res.status(200).json({
                success: true,
                data: {
                    visitorId,
                    session: targetSession,
                    allSessions,
                    totalDaysVisited: allSessions.length,
                    totalEventsCount: events.length,
                    events,
                    groupedDates
                }
            });
        } catch (error) {
            console.error('[VisitorController.getSessionJourney Error]:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch session journey',
                error: error.message
            });
        }
    }

    /**
     * Get active live shoppers list (snapshot)
     */
    async getLiveShoppers(req, res) {
        try {
            const liveList = visitorService.getLiveShoppers();
            const todayStr = getDhakaDateString();
            const todayTotal = await VisitorSession.countDocuments({ sessionDate: todayStr });

            return res.status(200).json({
                success: true,
                data: {
                    activeCount: liveList.length,
                    todayTotal,
                    shoppers: liveList
                }
            });
        } catch (error) {
            console.error('[VisitorController.getLiveShoppers Error]:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch live shoppers',
                error: error.message
            });
        }
    }

    /**
     * HTTP activity record endpoint (fallback)
     */
    async recordActivity(req, res) {
        try {
            const session = await visitorService.recordActivity(req.body, req);
            return res.status(200).json({
                success: true,
                data: session
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * Pre-order customer identification endpoint
     */
    async identifyCustomer(req, res) {
        try {
            const visitorId = req.body.visitorId;
            const profile = req.body.profile || req.body;
            const session = await visitorService.identifyCustomer(visitorId, profile);
            return res.status(200).json({
                success: true,
                data: session
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    // ==========================================
    // CUSTOM VISITOR OFFERS & TEMPLATES
    // ==========================================

    /**
     * Get all offer templates
     */
    async getOfferTemplates(req, res) {
        try {
            const templates = await visitorService.getOfferTemplates();
            return res.status(200).json({
                success: true,
                data: templates
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to fetch offer templates'
            });
        }
    }

    /**
     * Create an offer template
     */
    async createOfferTemplate(req, res) {
        try {
            const { name, title, message, buttonText, buttonUrl, delaySeconds, isActive } = req.body;
            if (!name || !title || !message) {
                return res.status(400).json({
                    success: false,
                    message: 'Template name, headline, and message are required'
                });
            }

            const template = await visitorService.createOfferTemplate({
                name,
                title,
                message,
                buttonText: buttonText || 'অর্ডার সম্পন্ন করুন',
                buttonUrl: buttonUrl || '/checkout',
                delaySeconds: Number(delaySeconds) || 0,
                isActive: isActive !== false,
                createdByName: req.user?.name || 'Admin'
            });

            return res.status(201).json({
                success: true,
                message: 'Template created successfully',
                data: template
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to create template'
            });
        }
    }

    /**
     * Update an offer template
     */
    async updateOfferTemplate(req, res) {
        try {
            const { id } = req.params;
            const template = await visitorService.updateOfferTemplate(id, req.body);
            if (!template) {
                return res.status(404).json({ success: false, message: 'Template not found' });
            }
            return res.status(200).json({
                success: true,
                message: 'Template updated successfully',
                data: template
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to update template'
            });
        }
    }

    /**
     * Delete an offer template
     */
    async deleteOfferTemplate(req, res) {
        try {
            const { id } = req.params;
            await visitorService.deleteOfferTemplate(id);
            return res.status(200).json({
                success: true,
                message: 'Template deleted successfully'
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to delete template'
            });
        }
    }

    /**
     * Dispatch Custom Offer to a visitor
     */
    async sendCustomOffer(req, res) {
        try {
            const {
                visitorId,
                customerPhone,
                customerName,
                title,
                message,
                buttonText,
                buttonUrl,
                delaySeconds,
                templateId
            } = req.body;

            if (!visitorId) {
                return res.status(400).json({ success: false, message: 'Visitor ID is required' });
            }
            if (!title || !message) {
                return res.status(400).json({ success: false, message: 'Title and message are required' });
            }

            const offer = await visitorService.sendCustomOffer({
                visitorId,
                customerPhone,
                customerName,
                title,
                message,
                buttonText,
                buttonUrl,
                delaySeconds,
                templateId,
                adminName: req.user?.name || 'Admin'
            });

            return res.status(200).json({
                success: true,
                message: 'Offer dispatched successfully to visitor screen',
                data: offer
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to dispatch offer'
            });
        }
    }

    /**
     * Get pending offer for a visitor (Called on site load or socket reconnect)
     */
    async getPendingOffer(req, res) {
        try {
            const { visitorId } = req.params;
            if (!visitorId) {
                return res.status(400).json({ success: false, message: 'Visitor ID is required' });
            }

            const offer = await visitorService.getPendingOfferForVisitor(visitorId);
            return res.status(200).json({
                success: true,
                data: offer || null
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * Handle visitor response (clicked or dismissed)
     */
    async recordOfferAction(req, res) {
        try {
            const { id } = req.params;
            const { action } = req.body; // 'clicked' or 'dismissed'

            const offer = await visitorService.recordOfferAction(id, action);
            return res.status(200).json({
                success: true,
                data: offer
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * Get offers history
     */
    async getOffersHistory(req, res) {
        try {
            const limit = req.query.limit || 50;
            const visitorId = req.query.visitorId;
            const history = await visitorService.getOffersHistory({ limit, visitorId });
            return res.status(200).json({
                success: true,
                data: history
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
}

module.exports = new VisitorController();
