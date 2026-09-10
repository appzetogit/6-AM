import mongoose from 'mongoose';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodPosHeldBill } from '../models/posHeldBill.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { createOrder } from '../../orders/services/order.service.js';
import { calculateOrderPricing } from '../../orders/services/order-pricing.service.js';
import { updateTransactionStatus } from '../../orders/services/foodTransaction.service.js';
import { FoodOrder } from '../../orders/models/order.model.js';

/**
 * The seller's till.
 *
 * Every sale still goes through createOrder — pricing, stock, the transaction
 * ledger, commission — so a counter sale is accounted for exactly like an app
 * order. What this module adds is everything the counter knows that the app
 * does not: who is being served, how they are taking the food, what was typed
 * in as a discount, and how the money actually arrived.
 *
 * Reads (customer lookup, the customer summary panel, the last bill, today's
 * orders) are scoped to the seller's own restaurant without exception: a
 * seller sees their own customers' history with them, never another shop's.
 */

const ORDER_TYPES = ['dine_in', 'take_away', 'walk_in', 'delivery'];
const TENDER_MODES = ['cash', 'upi', 'card'];
const PAYMENT_MODES = ['cash', 'upi', 'card', 'multiple', 'pay_later'];
const OPEN_ORDER_STATUSES = ['pending_payment', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const digitsOf = (s) => String(s || '').replace(/\D/g, '');
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

/** Marks the synthetic customer a nameless walk-in sale is booked against. */
const walkInPhoneFor = (restaurantId) => `pos-walkin-${String(restaurantId)}`;
const isWalkInPhone = (phone) => String(phone || '').startsWith('pos-walkin-');

// ───────────────────────────── input shaping ─────────────────────────────

function normalizeItems(rawItems) {
    if (!Array.isArray(rawItems) || !rawItems.length) {
        throw new ValidationError('At least one item is required');
    }
    return rawItems.map((raw) => {
        const itemId = String(raw?.itemId || raw?.id || '').trim();
        if (!itemId) throw new ValidationError('Every line needs an itemId');
        const quantity = Number(raw?.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) {
            throw new ValidationError('Quantity must be a whole number of at least 1');
        }
        const discount = Number(raw?.discount) || 0;
        if (discount < 0) throw new ValidationError('A line discount cannot be negative');
        return {
            itemId,
            quantity,
            variantId: String(raw?.variantId || '').trim(),
            discount: round2(discount)
        };
    });
}

function normalizeOrderType(raw) {
    const type = String(raw || 'walk_in').trim().toLowerCase();
    if (!ORDER_TYPES.includes(type)) {
        throw new ValidationError(`orderType must be one of ${ORDER_TYPES.join(', ')}`);
    }
    return type;
}

/**
 * What the cashier typed into the strip, turned into what the pricing engine
 * takes. Line discounts are summed into the manual amount; a percentage is
 * left for the engine, which alone knows the subtotal it applies to.
 */
function pricingInputOf(dto, items) {
    const lineDiscounts = items.reduce((sum, line) => sum + line.discount, 0);
    const flat = dto.flatDiscount && typeof dto.flatDiscount === 'object' ? dto.flatDiscount : {};
    const flatValue = Math.max(0, Number(flat.value) || 0);
    const isPercent = String(flat.type || 'percent') === 'percent';
    if (isPercent && flatValue > 100) throw new ValidationError('A percentage discount cannot exceed 100');

    return {
        couponCode: dto.couponCode ? String(dto.couponCode).trim().toUpperCase() : undefined,
        manualDiscount: round2(lineDiscounts + (isPercent ? 0 : flatValue)),
        manualDiscountPercent: isPercent ? flatValue : 0,
        additionalCharges: Math.max(0, Number(dto.additionalCharges) || 0),
        roundOff: dto.roundOff === true
    };
}

/** Which single method the order's payment snapshot names for a split bill. */
function dominantTenderMode(tenders) {
    const totals = new Map();
    for (const t of tenders) totals.set(t.mode, (totals.get(t.mode) || 0) + t.amount);
    let best = 'cash';
    let bestAmount = -1;
    for (const [mode, amount] of totals) {
        if (amount > bestAmount) { best = mode; bestAmount = amount; }
    }
    return best;
}

/**
 * Turns the strip's payment choice into the tender lines the order records.
 *
 * A single mode is one tender for the whole bill and 'pay_later' takes
 * nothing now. 'multiple' is the Pay screen: whatever was received, in
 * whatever mix. Short of the bill, the rest becomes a due against the
 * customer; over it, the excess is change handed back — and change is cash,
 * so it can only be given out of cash that came in.
 */
function resolveTenders(dto, total) {
    const mode = String(dto.paymentMode || dto.paymentMethod || 'cash').trim().toLowerCase();
    if (!PAYMENT_MODES.includes(mode)) {
        throw new ValidationError(`paymentMode must be one of ${PAYMENT_MODES.join(', ')}`);
    }

    if (mode === 'pay_later') {
        return { paymentMode: mode, tenders: [], paymentMethod: 'cash', dueAmount: total, changeGiven: 0 };
    }

    if (mode !== 'multiple') {
        return { paymentMode: mode, tenders: [{ mode, amount: total, at: new Date() }], paymentMethod: mode, dueAmount: 0, changeGiven: 0 };
    }

    const raw = Array.isArray(dto.tenders) ? dto.tenders : [];
    if (!raw.length) throw new ValidationError('A split payment needs at least one tender');
    const tenders = raw.map((t) => {
        const tenderMode = String(t?.mode || '').trim().toLowerCase();
        if (!TENDER_MODES.includes(tenderMode)) {
            throw new ValidationError(`Tender mode must be one of ${TENDER_MODES.join(', ')}`);
        }
        const amount = round2(t?.amount);
        if (!(amount > 0)) throw new ValidationError('Every tender needs an amount above zero');
        return { mode: tenderMode, amount, at: new Date(), note: String(t?.note || '').slice(0, 300) };
    });
    const received = round2(tenders.reduce((s, t) => s + t.amount, 0));
    const dueAmount = round2(Math.max(0, total - received));
    const changeGiven = round2(Math.max(0, received - total));
    const cashIn = round2(tenders.filter((t) => t.mode === 'cash').reduce((s, t) => s + t.amount, 0));
    if (changeGiven > cashIn + 0.001) {
        throw new ValidationError(`₹${changeGiven.toFixed(2)} change cannot be given — only ₹${cashIn.toFixed(2)} came in as cash`);
    }
    return { paymentMode: mode, tenders, paymentMethod: dominantTenderMode(tenders), dueAmount, changeGiven };
}

// ───────────────────────────── customers ─────────────────────────────

async function loadRestaurant(restaurantId) {
    if (!isId(restaurantId)) throw new NotFoundError('Restaurant not found');
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName ownerName ownerPhone primaryContactNumber addressLine1 addressLine2 area city state pincode location gstNumber fssaiNumber')
        .lean();
    if (!restaurant) throw new NotFoundError('Restaurant not found');
    return restaurant;
}

/**
 * Who the bill is for. An id or a phone names a real customer (created on
 * first sight, as before). Neither means an anonymous walk-in, which is
 * booked against one synthetic customer per shop so their history does not
 * pollute any real person's and so the order's userId is still a user.
 */
async function resolveCustomer(restaurantId, dto) {
    if (dto.customerId) {
        if (!isId(dto.customerId)) throw new ValidationError('customerId is not valid');
        const customer = await FoodUser.findById(dto.customerId);
        if (!customer) throw new NotFoundError('Customer not found');
        return customer;
    }

    const phone = digitsOf(dto.customerPhone);
    if (phone) {
        let customer = await FoodUser.findOne({ phone });
        if (!customer) {
            customer = await FoodUser.create({ phone, name: String(dto.customerName || '').trim() || 'Walk-in customer' });
        } else if (dto.customerName && !customer.name) {
            customer.name = String(dto.customerName).trim();
            await customer.save();
        }
        return customer;
    }

    const walkInPhone = walkInPhoneFor(restaurantId);
    const existing = await FoodUser.findOne({ phone: walkInPhone });
    if (existing) return existing;
    return FoodUser.create({ phone: walkInPhone, name: 'Walk in Customer', isVerified: false });
}

/** The shop's own address: where a counter sale is "delivered" to. */
function counterAddressOf(restaurant) {
    const coords = restaurant.location?.coordinates;
    const address = {
        label: 'Other',
        name: restaurant.restaurantName,
        fullName: restaurant.restaurantName,
        street: restaurant.addressLine1 || restaurant.location?.addressLine1 || restaurant.restaurantName,
        additionalDetails: restaurant.addressLine2 || restaurant.location?.addressLine2 || '',
        // The order schema requires a city and state on every address. For a
        // counter sale the address is the shop's own and purely descriptive,
        // so a profile that never filled these in must not block a sale.
        city: restaurant.city || restaurant.location?.city || restaurant.area || 'Not recorded',
        state: restaurant.state || restaurant.location?.state || 'Not recorded',
        zipCode: restaurant.pincode || restaurant.location?.pincode || '',
        phone: restaurant.ownerPhone || restaurant.primaryContactNumber || '',
        location: Array.isArray(coords) && coords.length === 2 ? { type: 'Point', coordinates: coords } : undefined
    };
    if (!address.location) {
        throw new ValidationError('This store has no saved location yet — set it up before taking POS orders');
    }
    return address;
}

/** A POS delivery goes to the customer's saved address; there is nothing else to go on. */
function deliveryAddressOf(customer) {
    const addresses = Array.isArray(customer?.addresses) ? customer.addresses : [];
    const chosen = addresses.find((a) => a?.isDefault) || addresses[0];
    if (!chosen) {
        throw new ValidationError('This customer has no saved address. Ask them to add one in the app, or bill it as take-away.');
    }
    const plain = typeof chosen.toObject === 'function' ? chosen.toObject() : { ...chosen };
    return { ...plain, phone: plain.phone || customer.phone || '' };
}

// ───────────────────────────── quote & sale ─────────────────────────────

/**
 * What the bill will come to, from the same engine that will charge it. The
 * totals strip shows this rather than a client-side sum so that tax, coupon
 * rules and clamping are never approximated twice.
 */
export async function quotePosOrder(restaurantId, dto = {}) {
    const restaurant = await loadRestaurant(restaurantId);
    const items = normalizeItems(dto.items);
    const orderType = normalizeOrderType(dto.orderType);
    const counterSale = orderType !== 'delivery';

    let customer = null;
    if (dto.customerId && isId(dto.customerId)) {
        customer = await FoodUser.findById(dto.customerId).select('phone addresses').lean();
    }
    const deliveryAddress = counterSale ? counterAddressOf(restaurant) : deliveryAddressOf(customer);

    const result = await calculateOrderPricing(
        customer?._id ? String(customer._id) : null,
        {
            restaurantId: String(restaurantId),
            items,
            deliveryAddress,
            ...pricingInputOf(dto, items)
        },
        { skipAvailabilityCheck: true, counterSale }
    );

    const byId = new Map(items.map((line) => [line.itemId, line]));
    return {
        orderType,
        items: (result.items || []).map((line) => {
            const entered = byId.get(String(line.itemId)) || {};
            const gross = round2(line.price * line.quantity);
            return {
                itemId: String(line.itemId),
                name: line.name,
                price: line.price,
                mrp: line.mrp ?? null,
                quantity: line.quantity,
                gstRate: line.gstRate ?? null,
                discount: entered.discount || 0,
                amount: round2(gross - (entered.discount || 0))
            };
        }),
        pricing: result.pricing
    };
}

/**
 * Rings the sale up.
 *
 * The quote runs first so the tenders can be checked against the exact bill
 * before anything is written: a split payment that does not add up is a
 * typo, and the place to catch a typo is before stock moves.
 */
export async function createPosOrder(restaurantId, dto = {}) {
    const restaurant = await loadRestaurant(restaurantId);
    const items = normalizeItems(dto.items);
    const orderType = normalizeOrderType(dto.orderType);
    const counterSale = orderType !== 'delivery';

    const customer = await resolveCustomer(restaurantId, dto);
    const address = counterSale ? counterAddressOf(restaurant) : deliveryAddressOf(customer);

    const quote = await quotePosOrder(restaurantId, { ...dto, customerId: String(customer._id), items });
    const total = round2(quote.pricing?.total);
    if (!(total > 0)) throw new ValidationError('Bill total must be above zero');

    const { paymentMode, tenders, paymentMethod, dueAmount, changeGiven } = resolveTenders(dto, total);
    if (dueAmount > 0 && isWalkInPhone(customer.phone)) {
        throw new ValidationError('Pay later needs a named customer — pick one or enter a phone number');
    }

    const result = await createOrder(String(customer._id), {
        restaurantId: String(restaurantId),
        items,
        address,
        paymentMethod,
        customerName: isWalkInPhone(customer.phone) ? 'Walk in Customer' : customer.name || String(dto.customerName || ''),
        customerPhone: isWalkInPhone(customer.phone) ? '' : customer.phone,
        pricing: pricingInputOf(dto, items),
        pos: {
            orderType,
            tableNo: String(dto.tableNo || ''),
            salesman: String(dto.salesman || ''),
            remarks: String(dto.remarks || ''),
            paymentMode,
            tenders,
            dueAmount,
            changeGiven
        }
    });

    // The bill number is the order number; kept on the pos block so it
    // survives any future renumbering of order_id.
    if (result?.order?._id) {
        const billNo = String(result.order.order_id || result.order.orderId || '');
        if (billNo) await FoodOrder.updateOne({ _id: result.order._id }, { $set: { 'pos.billNo': billNo } });
    }

    const saved = await FoodOrder.findById(result.order._id).lean();
    return { order: result.order, receipt: toReceipt(saved, restaurant) };
}

// ───────────────────────────── receivables ─────────────────────────────

/**
 * A payment against a pay-later bill. The due drops by the amount; when it
 * reaches zero the order is paid and the ledger's transaction is captured.
 */
export async function recordPosPayment(restaurantId, orderId, dto = {}) {
    if (!isId(orderId)) throw new NotFoundError('Bill not found');
    const order = await FoodOrder.findOne({ _id: orderId, restaurantId, source: 'pos' });
    if (!order) throw new NotFoundError('Bill not found');

    const due = round2(order.pos?.dueAmount);
    if (!(due > 0)) throw new ValidationError('Nothing is due on this bill');

    const mode = String(dto.mode || '').trim().toLowerCase();
    if (!TENDER_MODES.includes(mode)) throw new ValidationError(`mode must be one of ${TENDER_MODES.join(', ')}`);
    const amount = round2(dto.amount);
    if (!(amount > 0)) throw new ValidationError('Amount must be above zero');
    if (amount - due > 0.01) throw new ValidationError(`Only ₹${due.toFixed(2)} is due on this bill`);

    order.pos.tenders.push({ mode, amount, at: new Date(), note: String(dto.note || '') });
    order.pos.dueAmount = round2(Math.max(0, due - amount));
    order.payment.amountDue = order.pos.dueAmount;

    const settled = order.pos.dueAmount <= 0.009;
    if (settled) {
        order.pos.dueAmount = 0;
        order.payment.amountDue = 0;
        order.payment.status = 'paid';
        order.payment.method = dominantTenderMode(order.pos.tenders);
        const modes = new Set(order.pos.tenders.map((t) => t.mode));
        order.pos.paymentMode = modes.size > 1 ? 'multiple' : [...modes][0];
    }
    await order.save();

    if (settled) {
        await updateTransactionStatus(order._id, 'pos_payment', {
            status: 'captured',
            note: 'Pay-later bill settled at the counter',
            recordedByRole: 'RESTAURANT',
            recordedById: restaurantId
        }).catch(() => null);
    }

    return { orderId: String(order._id), dueAmount: order.pos.dueAmount, settled, tenders: order.pos.tenders };
}

// ───────────────────────────── customer panel ─────────────────────────────

/**
 * Digits look up a phone anywhere (a new walk-in has never ordered here);
 * letters look up a name only among people who have bought from this shop.
 */
export async function searchPosCustomers(restaurantId, query = '', limit = 10) {
    const q = String(query || '').trim();
    if (!q) return [];
    const cap = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 25);

    const digits = digitsOf(q);
    let filter;
    if (digits.length >= 4 && digits.length === q.replace(/[\s+\-()]/g, '').length) {
        filter = { phone: new RegExp('^' + digits) };
    } else {
        const userIds = await FoodOrder.distinct('userId', { restaurantId });
        if (!userIds.length) return [];
        filter = { _id: { $in: userIds }, name: new RegExp(escapeRegex(q), 'i') };
    }

    const rows = await FoodUser.find(filter).select('name phone').sort({ name: 1 }).limit(cap).lean();
    return rows
        .filter((u) => !isWalkInPhone(u.phone))
        .map((u) => ({ id: String(u._id), name: u.name || '', phone: u.phone || '' }));
}

/** The "Customer Details" panel: this customer's history with this shop only. */
export async function getPosCustomerSummary(restaurantId, userId) {
    if (!isId(userId)) throw new NotFoundError('Customer not found');
    const customer = await FoodUser.findById(userId).select('name phone').lean();
    if (!customer) throw new NotFoundError('Customer not found');

    const scope = {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        userId: new mongoose.Types.ObjectId(String(userId)),
        orderStatus: { $nin: OPEN_ORDER_STATUSES }
    };

    const [last, totals, top] = await Promise.all([
        FoodOrder.findOne(scope).sort({ createdAt: -1 }).select('createdAt pricing.total payment.method pos.paymentMode').lean(),
        FoodOrder.aggregate([
            { $match: scope },
            { $group: { _id: null, count: { $sum: 1 }, spent: { $sum: { $ifNull: ['$pricing.total', 0] } }, due: { $sum: { $ifNull: ['$pos.dueAmount', 0] } } } }
        ]),
        FoodOrder.aggregate([
            { $match: scope },
            { $unwind: '$items' },
            { $group: { _id: '$items.name', qty: { $sum: '$items.quantity' } } },
            { $sort: { qty: -1, _id: 1 } },
            { $limit: 1 }
        ])
    ]);

    const agg = totals[0] || { count: 0, spent: 0, due: 0 };
    return {
        id: String(customer._id),
        name: customer.name || '',
        phone: isWalkInPhone(customer.phone) ? '' : customer.phone || '',
        lastVisitedAt: last?.createdAt || null,
        lastBillAmount: last ? round2(last.pricing?.total) : null,
        mostPurchasedItem: top[0]?._id || null,
        lastPaymentMode: last ? (last.pos?.paymentMode || last.payment?.method || null) : null,
        duePayment: round2(agg.due),
        totalPurchases: agg.count,
        totalSpent: round2(agg.spent),
        // No loyalty programme exists in this system; the panel shows a dash.
        loyaltyPoints: null
    };
}

// ───────────────────────────── bills & orders ─────────────────────────────

const ORDER_TYPE_LABEL = { dine_in: 'Dine In', take_away: 'Take Away', walk_in: 'Walk In', delivery: 'Delivery' };

/** The shape a printed receipt and the "Last Bill" box read from. */
export function toReceipt(order, restaurant = null) {
    if (!order) return null;
    const pricing = order.pricing || {};
    return {
        id: String(order._id),
        billNo: order.pos?.billNo || order.order_id || order.orderId || String(order._id).slice(-6).toUpperCase(),
        createdAt: order.createdAt,
        orderType: order.pos?.orderType || 'walk_in',
        orderTypeLabel: ORDER_TYPE_LABEL[order.pos?.orderType] || 'Walk In',
        tableNo: order.pos?.tableNo || '',
        salesman: order.pos?.salesman || '',
        remarks: order.pos?.remarks || '',
        store: restaurant
            ? {
                name: restaurant.restaurantName || '',
                address: [restaurant.addressLine1, restaurant.area, restaurant.city, restaurant.pincode].filter(Boolean).join(', '),
                phone: restaurant.ownerPhone || restaurant.primaryContactNumber || '',
                gstNumber: restaurant.gstNumber || '',
                fssaiNumber: restaurant.fssaiNumber || ''
            }
            : null,
        customer: {
            name: order.customerName || 'Walk in Customer',
            phone: isWalkInPhone(order.customerPhone) ? '' : order.customerPhone || ''
        },
        items: (order.items || []).map((line) => ({
            name: line.name,
            variantName: line.variantName || '',
            quantity: line.quantity,
            price: line.price,
            discount: line.discount || 0,
            gstRate: line.gstRate ?? null,
            amount: round2(line.price * line.quantity - (line.discount || 0))
        })),
        pricing: {
            subtotal: round2(pricing.subtotal),
            tax: round2(pricing.tax),
            discount: round2(pricing.discount),
            manualDiscount: round2(pricing.manualDiscount),
            couponCode: pricing.couponCode || null,
            additionalCharges: round2(pricing.additionalCharges),
            roundOff: round2(pricing.roundOff),
            total: round2(pricing.total)
        },
        payment: {
            mode: order.pos?.paymentMode || order.payment?.method || 'cash',
            method: order.payment?.method || 'cash',
            status: order.payment?.status || '',
            tenders: order.pos?.tenders || [],
            dueAmount: round2(order.pos?.dueAmount)
        }
    };
}

export async function getLastPosBill(restaurantId) {
    const [order, restaurant] = await Promise.all([
        FoodOrder.findOne({ restaurantId, source: 'pos' }).sort({ createdAt: -1 }).lean(),
        loadRestaurant(restaurantId)
    ]);
    return toReceipt(order, restaurant);
}

/** By id, or by the bill number printed on the receipt — that is what gets scanned. */
export async function getPosBill(restaurantId, ref) {
    const key = String(ref || '').trim();
    if (!key) throw new NotFoundError('Bill not found');
    const filter = { restaurantId, source: 'pos' };
    if (isId(key)) filter._id = key;
    else filter.$or = [{ 'pos.billNo': key.toUpperCase() }, { order_id: key.toUpperCase() }];

    // The bill is checked first so that asking for another shop's bill says
    // "not found" and nothing about whether that shop exists.
    const order = await FoodOrder.findOne(filter).lean();
    if (!order) throw new NotFoundError('Bill not found');
    return toReceipt(order, await loadRestaurant(restaurantId));
}

/** Today's counter sales by default; a date narrows to that day, `all` lifts it. */
export async function listPosOrders(restaurantId, query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    const filter = { restaurantId, source: 'pos' };

    if (String(query.date || '') !== 'all') {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(query.date || ''));
        const base = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
        const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
        filter.createdAt = { $gte: start, $lte: end };
    }
    if (String(query.due) === 'true') filter['pos.dueAmount'] = { $gt: 0 };

    const rows = await FoodOrder.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const items = rows.map((o) => toReceipt(o));
    return {
        items,
        total: round2(items.reduce((s, r) => s + r.pricing.total, 0)),
        due: round2(items.reduce((s, r) => s + r.payment.dueAmount, 0))
    };
}

// ───────────────────────────── held bills ─────────────────────────────

export async function holdPosBill(restaurantId, dto = {}) {
    const rawItems = Array.isArray(dto.items) ? dto.items : [];
    if (!rawItems.length) throw new ValidationError('There is nothing on the bill to hold');

    const items = rawItems.map((raw) => ({
        itemId: String(raw?.itemId || raw?.id || '').trim(),
        name: String(raw?.name || ''),
        variantId: String(raw?.variantId || ''),
        price: Math.max(0, Number(raw?.price) || 0),
        quantity: Math.max(1, parseInt(raw?.quantity, 10) || 1),
        discount: Math.max(0, Number(raw?.discount) || 0)
    }));
    if (items.some((line) => !line.itemId)) throw new ValidationError('Every line needs an itemId');

    const held = await FoodPosHeldBill.create({
        restaurantId,
        customer: {
            userId: dto.customerId && isId(dto.customerId) ? dto.customerId : null,
            name: String(dto.customerName || ''),
            phone: digitsOf(dto.customerPhone)
        },
        orderType: normalizeOrderType(dto.orderType),
        tableNo: String(dto.tableNo || ''),
        salesman: String(dto.salesman || ''),
        remarks: String(dto.remarks || ''),
        items,
        flatDiscount: {
            type: String(dto.flatDiscount?.type || 'percent') === 'flat' ? 'flat' : 'percent',
            value: Math.max(0, Number(dto.flatDiscount?.value) || 0)
        },
        additionalCharges: Math.max(0, Number(dto.additionalCharges) || 0),
        roundOff: dto.roundOff === true,
        couponCode: String(dto.couponCode || ''),
        estimatedTotal: Math.max(0, Number(dto.estimatedTotal) || 0),
        heldBy: String(dto.salesman || '')
    });
    return held.toObject();
}

export async function listHeldBills(restaurantId) {
    const rows = await FoodPosHeldBill.find({ restaurantId }).sort({ createdAt: -1 }).limit(100).lean();
    return rows.map((h) => ({ ...h, id: String(h._id) }));
}

/** Resuming removes the hold: a bill is either parked or on the screen, never both. */
export async function takeHeldBill(restaurantId, heldId) {
    if (!isId(heldId)) throw new NotFoundError('Held bill not found');
    const held = await FoodPosHeldBill.findOneAndDelete({ _id: heldId, restaurantId }).lean();
    if (!held) throw new NotFoundError('Held bill not found');
    return { ...held, id: String(held._id) };
}

export async function discardHeldBill(restaurantId, heldId) {
    if (!isId(heldId)) throw new NotFoundError('Held bill not found');
    const res = await FoodPosHeldBill.deleteOne({ _id: heldId, restaurantId });
    if (!res.deletedCount) throw new NotFoundError('Held bill not found');
    return { deleted: true };
}
