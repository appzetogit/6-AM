import mongoose from 'mongoose';

import { FoodOrder } from '../models/order.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';

/**
 * Whether a coupon may be applied to a bill, and if not, why.
 *
 * This exists because two callers need the same answer and must never disagree:
 * the pricing engine, which decides what the order is actually charged, and the
 * till's coupon list, which shows the cashier what they can offer. A second
 * implementation of these rules would drift within a release, and the drift
 * shows up as a list that says "Apply" over a quote that then refuses.
 *
 * The evaluation is deliberately synchronous. Judging a list of coupons one at
 * a time would be two database round trips per coupon; instead the caller
 * resolves the customer's facts once with loadCouponCustomerFacts() and passes
 * them in, so twenty coupons cost the same two queries as one.
 */

const round0 = (n) => Math.max(0, Math.floor(Number(n) || 0));

/**
 * The rupees a coupon takes off, given the goods it applies to.
 *
 * Floored, not rounded, and never more than the bill: a coupon may reduce a
 * bill to zero but must never make it negative, which would push the tax base
 * below zero further down.
 */
export function couponDiscountFor(offer, subtotal) {
    const goods = Math.max(0, Number(subtotal) || 0);
    if (offer?.discountType === 'percentage') {
        const raw = (goods * (Number(offer.discountValue) || 0)) / 100;
        const capped = Number(offer.maxDiscount) ? Math.min(raw, Number(offer.maxDiscount)) : raw;
        return Math.min(goods, round0(capped));
    }
    return Math.min(goods, round0(offer?.discountValue));
}

/**
 * The end of an all-day expiry.
 *
 * An end date saved as midnight means "through that day", not "until the
 * moment it began" — treating it literally expires a coupon a day early, which
 * is the sort of thing a customer notices at a counter.
 */
const endOfOfferWindow = (endDate) => {
    if (!endDate) return null;
    const end = new Date(endDate);
    if (end.getHours() === 0 && end.getMinutes() === 0) end.setHours(23, 59, 59, 999);
    return end;
};

const restaurantIdsOf = (offer) =>
    Array.isArray(offer?.restaurantIds) && offer.restaurantIds.length > 0
        ? offer.restaurantIds
        : [offer?.restaurantId].filter(Boolean);

/**
 * Everything about a customer the coupon rules depend on, in two queries.
 *
 * Pass null for an anonymous walk-in: the per-customer rules then cannot be
 * tested, and evaluateCoupon reports that rather than guessing either way.
 */
export async function loadCouponCustomerFacts(userId, offerIds = []) {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
    const id = new mongoose.Types.ObjectId(String(userId));

    const [orderCount, usages] = await Promise.all([
        FoodOrder.countDocuments({ userId: id }),
        offerIds.length
            ? FoodOfferUsage.find({ userId: id, offerId: { $in: offerIds } }).select('offerId count').lean()
            : []
    ]);

    return {
        id: String(userId),
        orderCount,
        usedCountByOffer: new Map(usages.map((u) => [String(u.offerId), Number(u.count) || 0]))
    };
}

/**
 * Judges one coupon.
 *
 * Reasons are ordered by what a cashier can do about them: "add ₹120 more" is
 * worth saying before "this campaign is finished", because only one of them
 * ends with a sale.
 */
export function evaluateCoupon(offer, { subtotal = 0, restaurantId = '', now = new Date(), customer = null } = {}) {
    const refuse = (reason) => ({ eligible: false, reason, discount: 0 });
    if (!offer) return refuse('No such coupon');

    // Dates are judged before status on purpose. An expired campaign is also
    // flipped to inactive by the monthly sweep, and "Not active" tells the
    // cashier nothing they can repeat to the customer — "Expired" does.
    const end = endOfOfferWindow(offer.endDate);
    if (end && now > end) return refuse('Expired');
    if (offer.startDate && now < new Date(offer.startDate)) {
        return refuse(`Starts ${new Date(offer.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
    }

    if (offer.status === 'paused') return refuse('Paused by admin');
    if (offer.status !== 'active') return refuse('Not active');
    if (offer.showInCart === false) return refuse('Hidden by admin');

    if (offer.restaurantScope === 'selected') {
        const allowed = restaurantIdsOf(offer).some((id) => String(id) === String(restaurantId || ''));
        if (!allowed) return refuse('Not for this store');
    }

    const goods = Math.max(0, Number(subtotal) || 0);
    const minimum = Number(offer.minOrderValue) || 0;
    if (goods < minimum) return refuse(`Needs ₹${minimum} minimum — ₹${Math.ceil(minimum - goods)} more`);

    if (Number(offer.usageLimit) > 0 && Number(offer.usedCount || 0) >= Number(offer.usageLimit)) {
        return refuse('Fully used up');
    }

    const needsCustomer =
        Number(offer.perUserLimit) > 0 || offer.customerScope === 'first-time' || offer.isFirstOrderOnly === true;

    if (needsCustomer && !customer) {
        // An anonymous walk-in cannot be tested against a per-customer rule, and
        // the pricing engine will refuse it for the same reason. Saying so beats
        // offering it and having the sale bounce.
        return refuse('Pick a customer to use this');
    }

    if (customer) {
        if (Number(offer.perUserLimit) > 0) {
            const used = customer.usedCountByOffer.get(String(offer._id)) || 0;
            if (used >= Number(offer.perUserLimit)) return refuse('This customer has used it');
        }
        if ((offer.customerScope === 'first-time' || offer.isFirstOrderOnly === true) && customer.orderCount > 0) {
            return refuse('First-time customers only');
        }
    }

    const discount = couponDiscountFor(offer, goods);
    if (discount <= 0) return refuse('Works out to no discount on this bill');

    return { eligible: true, reason: '', discount };
}

/** "20% off, up to ₹100" / "₹50 off" — what the cashier reads out. */
export function describeCoupon(offer) {
    if (!offer) return '';
    if (offer.discountType === 'percentage') {
        const cap = Number(offer.maxDiscount) ? `, up to ₹${Number(offer.maxDiscount)}` : '';
        return `${Number(offer.discountValue) || 0}% off${cap}`;
    }
    return `₹${Number(offer.discountValue) || 0} off`;
}

/** Whether a coupon's eligibility depends on who the customer is. */
export function isCustomerScoped(offer) {
    return (
        Number(offer?.perUserLimit) > 0 ||
        offer?.customerScope === 'first-time' ||
        offer?.isFirstOrderOnly === true
    );
}
