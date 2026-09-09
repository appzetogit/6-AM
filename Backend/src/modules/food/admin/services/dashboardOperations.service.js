import mongoose from 'mongoose';

import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodOffer } from '../models/offer.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodSubscriptionInvoice } from '../../restaurant/models/subscriptionInvoice.model.js';
import { FoodRestaurantWithdrawal } from '../../restaurant/models/foodRestaurantWithdrawal.model.js';
import { FoodDeliveryWithdrawal } from '../../delivery/models/foodDeliveryWithdrawal.model.js';
import { FoodLoginAudit } from '../../../../core/auth/loginAudit.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * The operational half of the dashboard: coupons, money owed in both
 * directions, and the login log.
 *
 * Receivable and payable are mapped onto what this business actually owes and
 * is owed, which is not quite the reference ERP's wording:
 *
 *   Receivable — sellers owe the platform their monthly subscription dues, held
 *                as invoices in food_subscription_invoices.
 *   Payable    — the platform owes sellers and riders their approved earnings,
 *                held as withdrawal requests awaiting payout.
 *
 * There is no customer-invoice or supplier ledger here: customers pay at
 * checkout or on delivery, and the platform buys nothing from suppliers. Naming
 * those columns "Customer" and "Supplier" would describe a system that does not
 * exist, so they say Seller and Rider.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const parseDay = (raw, endOfDay = false) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw || '').trim());
    if (!m) throw new ValidationError('Dates must be in YYYY-MM-DD format');
    const [, y, mo, d] = m;
    return endOfDay ? new Date(+y, +mo - 1, +d, 23, 59, 59, 999) : new Date(+y, +mo - 1, +d);
};

const dateRange = (query = {}) => {
    const now = new Date();
    const start = query.from ? parseDay(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = query.to ? parseDay(query.to, true) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    if (start > end) throw new ValidationError('"from" cannot be after "to"');
    return { start, end };
};

const todayRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end };
};

const parseLimit = (raw, fallback = 10) =>
    Math.min(Math.max(parseInt(raw, 10) || fallback, 1), 100);

/** Same settled-order definition the sales widgets use. */
const SETTLED_ORDER_MATCH = {
    orderStatus: {
        $nin: ['pending_payment', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin']
    },
    $or: [
        { 'payment.method': { $in: ['cash', 'wallet'] } },
        { 'payment.status': { $in: ['paid', 'authorized'] } }
    ]
};

// ────────────────────────────── Top coupons ──────────────────────────────

/**
 * Coupons by how much billing they carried in the period.
 *
 * Grouped on the code snapshotted on the order, not on the offers collection,
 * so a coupon since deleted still shows the business it brought in.
 */
export async function getTopCoupons(query = {}) {
    const { start, end } = dateRange(query);
    const limit = parseLimit(query.limit, 10);

    const match = {
        ...SETTLED_ORDER_MATCH,
        createdAt: { $gte: start, $lte: end },
        'pricing.couponCode': { $nin: [null, ''] }
    };
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(String(query.restaurantId))) {
        match.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
    }

    const rows = await FoodOrder.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$pricing.couponCode',
                bills: { $sum: 1 },
                totalBillAmount: { $sum: { $ifNull: ['$pricing.total', 0] } },
                discountGiven: { $sum: { $ifNull: ['$pricing.discount', 0] } }
            }
        },
        { $sort: { totalBillAmount: -1 } },
        { $limit: limit }
    ]);

    // An offer has no title — the code is its name — so the lookup is only for
    // the terms, and a code whose offer has since been deleted still lists.
    const offers = rows.length
        ? await FoodOffer.find({ couponCode: { $in: rows.map((r) => r._id) } })
            .select('couponCode discountType discountValue status')
            .lean()
        : [];
    const offerOf = new Map(offers.map((o) => [o.couponCode, o]));

    return {
        from: start,
        to: end,
        coupons: rows.map((r) => {
            const offer = offerOf.get(r._id);
            return {
                couponCode: r._id,
                couponName: r._id,
                terms: offer
                    ? (offer.discountType === 'percentage'
                        ? `${offer.discountValue}% off`
                        : `₹${offer.discountValue} off`)
                    : '',
                status: offer?.status || 'deleted',
                bills: r.bills,
                totalBillAmount: round2(r.totalBillAmount),
                discountGiven: round2(r.discountGiven)
            };
        })
    };
}

// ───────────────────────── Receivable (from sellers) ─────────────────────────

/**
 * Subscription invoices still owed.
 *
 * `today: true` narrows to invoices whose billing period closed today — the
 * ones that just became collectable — which is what the reference's "Today's
 * Receivable" panel means. Without it, everything outstanding is listed.
 */
export async function getReceivables(query = {}) {
    const limit = parseLimit(query.limit, 10);
    const match = { status: { $in: ['pending', 'partially_settled'] } };

    if (String(query.today) === 'true') {
        const { start, end } = todayRange();
        match.periodEnd = { $gte: start, $lte: end };
    }
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(String(query.restaurantId))) {
        match.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
    }

    const rows = await FoodSubscriptionInvoice.find(match)
        .sort({ periodEnd: 1 })
        .limit(limit)
        .lean();

    const restaurants = rows.length
        ? await FoodRestaurant.find({ _id: { $in: rows.map((r) => r.restaurantId) } })
            .select('restaurantName')
            .lean()
        : [];
    const nameOf = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));

    const items = rows.map((r) => ({
        id: String(r._id),
        partyName: nameOf.get(String(r.restaurantId)) || 'Unknown seller',
        // Invoices carry no printed number; the billing month is what identifies
        // one to a seller, and it is unique per seller by index.
        invoiceNo: r.billingMonth || String(r._id).slice(-6).toUpperCase(),
        periodEnd: r.periodEnd || null,
        // The invoice keeps its own outstanding figure, and it is the only one
        // that is right: totalAmount minus paidAmount ignores waivers and
        // manual adjustments, both of which move what a seller actually owes.
        pendingAmount: round2(r.outstandingAmount)
    }));

    return {
        items,
        total: round2(items.reduce((s, i) => s + i.pendingAmount, 0)),
        scope: String(query.today) === 'true' ? 'today' : 'all'
    };
}

// ────────────────────────── Payable (to sellers/riders) ──────────────────────

/** Withdrawal requests awaiting payout, from sellers and riders together. */
export async function getPayables(query = {}) {
    const limit = parseLimit(query.limit, 10);
    const onlyToday = String(query.today) === 'true';
    const dateFilter = onlyToday ? (() => { const { start, end } = todayRange(); return { createdAt: { $gte: start, $lte: end } }; })() : {};

    const [sellerRows, riderRows] = await Promise.all([
        FoodRestaurantWithdrawal.find({ status: 'pending', ...dateFilter }).sort({ createdAt: 1 }).limit(limit).lean(),
        FoodDeliveryWithdrawal.find({ status: 'pending', ...dateFilter }).sort({ createdAt: 1 }).limit(limit).lean()
    ]);

    const [restaurants, riders] = await Promise.all([
        sellerRows.length
            ? FoodRestaurant.find({ _id: { $in: sellerRows.map((r) => r.restaurantId) } }).select('restaurantName').lean()
            : [],
        riderRows.length
            ? FoodDeliveryPartner.find({ _id: { $in: riderRows.map((r) => r.deliveryPartnerId) } }).select('name fullName').lean()
            : []
    ]);
    const restaurantName = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));
    const riderName = new Map(riders.map((r) => [String(r._id), r.name || r.fullName]));

    const items = [
        ...sellerRows.map((r) => ({
            id: String(r._id),
            partyType: 'Seller',
            partyName: restaurantName.get(String(r.restaurantId)) || 'Unknown seller',
            billNo: String(r._id).slice(-6).toUpperCase(),
            requestedAt: r.createdAt,
            pendingAmount: round2(r.amount)
        })),
        ...riderRows.map((r) => ({
            id: String(r._id),
            partyType: 'Rider',
            partyName: riderName.get(String(r.deliveryPartnerId)) || 'Unknown rider',
            billNo: String(r._id).slice(-6).toUpperCase(),
            requestedAt: r.createdAt,
            pendingAmount: round2(r.amount)
        }))
    ]
        .sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt))
        .slice(0, limit);

    return {
        items,
        total: round2(items.reduce((s, i) => s + i.pendingAmount, 0)),
        scope: onlyToday ? 'today' : 'all'
    };
}

// ─────────────────────────────── Login log ───────────────────────────────

export async function getLoginLog(query = {}) {
    const limit = parseLimit(query.limit, 10);
    const filter = {};
    if (query.role) filter.role = String(query.role).toUpperCase();
    if (query.from || query.to) {
        const { start, end } = dateRange(query);
        filter.loginAt = { $gte: start, $lte: end };
    }

    const [rows, total] = await Promise.all([
        FoodLoginAudit.find(filter).sort({ loginAt: -1 }).limit(limit).lean(),
        FoodLoginAudit.countDocuments(filter)
    ]);

    return {
        total,
        logins: rows.map((r) => ({
            id: String(r._id),
            name: r.name || 'Unknown',
            role: r.role,
            identifier: r.identifier || '',
            loginAt: r.loginAt,
            ipAddress: r.ipAddress || '',
            systemDetails: r.systemDetails || 'Unknown device'
        }))
    };
}

/** Everything on this half of the dashboard, in one round trip. */
export async function getDashboardOperations(query = {}) {
    const [coupons, todayReceivable, toReceive, todayPayable, toPay, loginLog] = await Promise.all([
        getTopCoupons(query),
        getReceivables({ ...query, today: 'true' }),
        getReceivables({ ...query, today: 'false' }),
        getPayables({ ...query, today: 'true' }),
        getPayables({ ...query, today: 'false' }),
        getLoginLog({ limit: query.loginLimit || 5 })
    ]);
    return { coupons, todayReceivable, toReceive, todayPayable, toPay, loginLog };
}
