import mongoose from 'mongoose';

import { FoodProductSubscription } from '../../user/models/productSubscription.model.js';
import { FoodSubscriptionOccurrence } from '../../user/models/subscriptionOccurrence.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodItem } from '../models/food.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { createSubscription } from '../../user/services/productSubscription.service.js';
import { validateCreateSubscriptionDto } from '../../user/validators/productSubscription.validator.js';
import { NotFoundError, ValidationError } from '../../../../core/auth/errors.js';

/**
 * Admin views over customer product subscriptions, plus the one write.
 *
 * Three things are on offer here, because they answer different questions:
 *
 *  - listDeliveries() is the morning operational view — what is due today, what
 *    became an order, and what failed. Occurrences are the unit, not
 *    subscriptions, because a day's work is a list of deliveries.
 *  - listSubscriptions() is the standing-arrangement view — who is subscribed to
 *    what, how often, and is it still active.
 *  - createSubscriptionForCustomer() sets one up on a customer's behalf, for the
 *    customer who phones the shop instead of using the app.
 *
 * That write deliberately delegates to the customer-facing service rather than
 * repeating its logic: the subscribable check, the address lookup and the
 * occurrence generation are the same rules whoever starts the subscription, and
 * a second copy of them would drift from the app's within a release.
 */

const MAX_LIMIT = 200;

const parsePaging = (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), MAX_LIMIT);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    return { page, limit, skip: (page - 1) * limit };
};

const startOfDay = (date) => {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
};

const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
};

/**
 * Reads a ?date=YYYY-MM-DD filter as a local calendar day.
 *
 * Occurrences are stored at local midnight, so the day has to be built from the
 * date parts rather than parsed as an ISO instant — `new Date('2026-09-08')` is
 * UTC midnight, which lands on the previous day for any timezone behind UTC and
 * would quietly show the wrong day's deliveries.
 */
const resolveDay = (raw) => {
    if (!raw) return startOfDay(new Date());
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
    if (!match) throw new ValidationError('date must be in YYYY-MM-DD format');
    const [, y, m, d] = match;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    if (Number.isNaN(parsed.getTime())) throw new ValidationError('Invalid date');
    return parsed;
};

const toObjectId = (value, label) => {
    if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
        throw new ValidationError(`Invalid ${label}`);
    }
    return new mongoose.Types.ObjectId(String(value));
};

/**
 * Resolves display names for a batch of rows in one query per collection.
 *
 * The alternative — a lookup per row — is the difference between four queries
 * and four hundred on a busy morning.
 */
const buildNameMaps = async (rows) => {
    const ids = (key) => [...new Set(rows.map((r) => String(r[key] || '')).filter(Boolean))];

    const [users, restaurants, items] = await Promise.all([
        FoodUser.find({ _id: { $in: ids('userId') } }).select('name fullName phone').lean(),
        FoodRestaurant.find({ _id: { $in: ids('restaurantId') } }).select('restaurantName').lean(),
        FoodItem.find({ _id: { $in: ids('itemId') } }).select('name image').lean(),
    ]);

    return {
        users: new Map(users.map((u) => [String(u._id), u])),
        restaurants: new Map(restaurants.map((r) => [String(r._id), r])),
        items: new Map(items.map((i) => [String(i._id), i])),
    };
};

const customerOf = (maps, userId) => {
    const user = maps.users.get(String(userId));
    return {
        id: String(userId || ''),
        name: user?.name || user?.fullName || 'Unknown customer',
        phone: user?.phone || '',
    };
};

const serializeSubscription = (sub, maps) => ({
    id: String(sub._id),
    _id: sub._id,
    customer: customerOf(maps, sub.userId),
    restaurantId: String(sub.restaurantId || ''),
    restaurantName: maps.restaurants.get(String(sub.restaurantId))?.restaurantName || 'Unknown Restaurant',
    itemId: String(sub.itemId || ''),
    // The subscription snapshots the name at signup; fall back to the live item
    // so a row saved before that field existed still reads correctly.
    itemName: sub.itemName || maps.items.get(String(sub.itemId))?.name || 'Unknown item',
    itemImage: maps.items.get(String(sub.itemId))?.image || '',
    quantity: sub.quantity,
    frequency: sub.frequency,
    daysOfWeek: sub.daysOfWeek || [],
    dayOfMonth: sub.dayOfMonth ?? null,
    deliveryTime: sub.deliveryTime,
    startDate: sub.startDate,
    paymentMethod: sub.paymentMethod,
    status: sub.status,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
});

/**
 * Standing subscriptions, newest first.
 *
 * `search` matches the item name snapshot and the customer's name or phone —
 * the three things someone has in hand when a customer calls about a delivery.
 */
export async function listSubscriptions(query = {}) {
    const { page, limit, skip } = parsePaging(query);
    const filter = {};

    if (query.status && ['active', 'paused', 'cancelled'].includes(String(query.status))) {
        filter.status = String(query.status);
    }
    if (query.frequency && ['daily', 'weekly', 'monthly'].includes(String(query.frequency))) {
        filter.frequency = String(query.frequency);
    }
    if (query.restaurantId) {
        filter.restaurantId = toObjectId(query.restaurantId, 'restaurantId');
    }

    const term = String(query.search || '').trim();
    if (term) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(escaped, 'i');
        // Customers are matched by resolving them first: the subscription stores
        // only a userId, so a name or phone search has to become an id list.
        const matchedUsers = await FoodUser.find({
            $or: [{ name: rx }, { fullName: rx }, { phone: rx }],
        }).select('_id').lean();

        filter.$or = [
            { itemName: rx },
            ...(matchedUsers.length ? [{ userId: { $in: matchedUsers.map((u) => u._id) } }] : []),
        ];
    }

    const [rows, total] = await Promise.all([
        FoodProductSubscription.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        FoodProductSubscription.countDocuments(filter),
    ]);

    const maps = await buildNameMaps(rows);
    return {
        subscriptions: rows.map((sub) => serializeSubscription(sub, maps)),
        total,
        page,
        limit,
    };
}

/** One subscription with its upcoming schedule and recent history. */
export async function getSubscriptionDetail(subscriptionId) {
    const id = toObjectId(subscriptionId, 'subscriptionId');
    const sub = await FoodProductSubscription.findById(id).lean();
    if (!sub) throw new NotFoundError('Subscription not found');

    const maps = await buildNameMaps([sub]);

    const today = startOfDay(new Date());
    const [upcoming, recent] = await Promise.all([
        FoodSubscriptionOccurrence.find({ subscriptionId: id, scheduledDate: { $gte: today } })
            .sort({ scheduledDate: 1 })
            .limit(30)
            .lean(),
        FoodSubscriptionOccurrence.find({ subscriptionId: id, scheduledDate: { $lt: today } })
            .sort({ scheduledDate: -1 })
            .limit(30)
            .lean(),
    ]);

    const serializeOccurrence = (o) => ({
        id: String(o._id),
        scheduledDate: o.scheduledDate,
        deliveryTime: o.deliveryTime,
        status: o.status,
        orderId: o.orderId ? String(o.orderId) : null,
        cancelReason: o.cancelReason || '',
        failureReason: o.failureReason || '',
    });

    return {
        subscription: serializeSubscription(sub, maps),
        upcoming: upcoming.map(serializeOccurrence),
        recent: recent.map(serializeOccurrence),
    };
}

/**
 * The deliveries scheduled for one calendar day — the operational board.
 *
 * Defaults to today. Each row carries the customer and item so the list is
 * usable on its own, without opening every subscription behind it.
 */
export async function listDeliveries(query = {}) {
    const { page, limit, skip } = parsePaging(query);
    const day = resolveDay(query.date);
    const filter = { scheduledDate: { $gte: day, $lt: addDays(day, 1) } };

    if (query.status && ['scheduled', 'cancelled', 'order_placed', 'failed'].includes(String(query.status))) {
        filter.status = String(query.status);
    }
    if (query.restaurantId) {
        filter.restaurantId = toObjectId(query.restaurantId, 'restaurantId');
    }

    const [rows, total] = await Promise.all([
        FoodSubscriptionOccurrence.find(filter)
            .sort({ deliveryTime: 1, createdAt: 1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodSubscriptionOccurrence.countDocuments(filter),
    ]);

    // Occurrences carry no item, so the parent subscriptions supply it.
    const subIds = [...new Set(rows.map((r) => String(r.subscriptionId)).filter(Boolean))];
    const subs = await FoodProductSubscription.find({ _id: { $in: subIds } })
        .select('itemId itemName quantity frequency paymentMethod status')
        .lean();
    const subMap = new Map(subs.map((s) => [String(s._id), s]));

    const maps = await buildNameMaps(
        rows.map((r) => ({
            userId: r.userId,
            restaurantId: r.restaurantId,
            itemId: subMap.get(String(r.subscriptionId))?.itemId,
        }))
    );

    // Only the rows that actually became orders need the order number.
    const orderIds = rows.map((r) => r.orderId).filter(Boolean);
    const orders = orderIds.length
        ? await FoodOrder.find({ _id: { $in: orderIds } }).select('orderId orderStatus').lean()
        : [];
    const orderMap = new Map(orders.map((o) => [String(o._id), o]));

    const deliveries = rows.map((occurrence) => {
        const sub = subMap.get(String(occurrence.subscriptionId));
        const order = occurrence.orderId ? orderMap.get(String(occurrence.orderId)) : null;
        return {
            id: String(occurrence._id),
            subscriptionId: String(occurrence.subscriptionId),
            scheduledDate: occurrence.scheduledDate,
            deliveryTime: occurrence.deliveryTime,
            status: occurrence.status,
            customer: customerOf(maps, occurrence.userId),
            restaurantId: String(occurrence.restaurantId || ''),
            restaurantName:
                maps.restaurants.get(String(occurrence.restaurantId))?.restaurantName || 'Unknown Restaurant',
            itemName: sub?.itemName || maps.items.get(String(sub?.itemId))?.name || 'Unknown item',
            itemImage: maps.items.get(String(sub?.itemId))?.image || '',
            quantity: sub?.quantity ?? null,
            frequency: sub?.frequency || '',
            paymentMethod: sub?.paymentMethod || '',
            subscriptionStatus: sub?.status || '',
            order: order ? { id: String(order._id), orderId: order.orderId, status: order.orderStatus } : null,
            failureReason: occurrence.failureReason || '',
            cancelReason: occurrence.cancelReason || '',
        };
    });

    return { deliveries, total, page, limit, date: day };
}

/**
 * Starts a subscription on a customer's behalf.
 *
 * The customer who rings the shop to say "one litre every morning" gets the
 * same arrangement as one who taps it into the app: the same validator, the
 * same createSubscription, and therefore the same refusal if the product is
 * not subscribable or the address is not theirs. The only thing this adds is
 * the customerId — which the app takes from a token and an admin must state —
 * and the check that it names a real customer, since nothing upstream has
 * proved it the way a token would.
 */
export async function createSubscriptionForCustomer(body = {}) {
    const userId = toObjectId(body.customerId, 'customerId');

    const customer = await FoodUser.findById(userId).select('_id role isActive').lean();
    if (!customer) throw new NotFoundError('Customer not found');
    if (customer.isActive === false) {
        throw new ValidationError('This customer account is deactivated — reactivate it before starting a subscription');
    }

    const dto = validateCreateSubscriptionDto(body);
    const { subscription } = await createSubscription(userId, dto);

    // Returned in the same shape the list uses, so the row the admin just
    // created renders identically to the ones already on screen.
    const maps = await buildNameMaps([subscription]);
    return { subscription: serializeSubscription(subscription, maps) };
}

/**
 * Counts for one day, by occurrence status.
 *
 * Returned alongside the board so the header can show the shape of the day
 * without the client paging through every row to add them up.
 */
export async function getDeliverySummary(query = {}) {
    const day = resolveDay(query.date);
    const match = { scheduledDate: { $gte: day, $lt: addDays(day, 1) } };
    if (query.restaurantId) {
        match.restaurantId = toObjectId(query.restaurantId, 'restaurantId');
    }

    const grouped = await FoodSubscriptionOccurrence.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const counts = { scheduled: 0, order_placed: 0, cancelled: 0, failed: 0 };
    for (const row of grouped) {
        if (row._id in counts) counts[row._id] = row.count;
    }

    return {
        date: day,
        counts,
        total: Object.values(counts).reduce((sum, n) => sum + n, 0),
        activeSubscriptions: await FoodProductSubscription.countDocuments({ status: 'active' }),
    };
}
