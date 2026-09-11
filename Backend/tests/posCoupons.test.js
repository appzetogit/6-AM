import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectTestDb, disconnectTestDb, resetDb, someId } from './helpers/db.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';
import { FoodOffer } from '../src/modules/food/admin/models/offer.model.js';
import { FoodOfferUsage } from '../src/modules/food/admin/models/offerUsage.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodUser } from '../src/core/users/user.model.js';
import { FoodOrder } from '../src/modules/food/orders/models/order.model.js';
import * as pos from '../src/modules/food/restaurant/services/pos.service.js';
import {
    evaluateCoupon,
    couponDiscountFor,
    describeCoupon,
    loadCouponCustomerFacts
} from '../src/modules/food/orders/services/coupon-eligibility.service.js';

/**
 * Coupons at the till.
 *
 * The list and the pricing engine share one implementation of these rules, and
 * the test that matters most is the last suite: whatever the list tells the
 * cashier they can use, the quote has to honour, and whatever it refuses the
 * quote has to refuse too. That is the whole reason the rules were extracted.
 */

before(connectTestDb);
after(disconnectTestDb);
beforeEach(resetDb);

const SHOP_LNG = 77.59;
const SHOP_LAT = 12.97;

const makeZone = () =>
    FoodZone.create({
        name: 'Test Zone',
        coordinates: [
            { latitude: 12.9, longitude: 77.5 },
            { latitude: 12.9, longitude: 77.7 },
            { latitude: 13.05, longitude: 77.7 },
            { latitude: 13.05, longitude: 77.5 }
        ]
    });

const makeShop = async (over = {}) => {
    await makeZone();
    return FoodRestaurant.create({
        restaurantName: 'Corner Store',
        ownerName: 'Owner',
        ownerPhone: '9000000001',
        phone: '9000000001',
        status: 'approved',
        addressLine1: '12 Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        location: { type: 'Point', coordinates: [SHOP_LNG, SHOP_LAT] },
        ...over
    });
};

const makeProduct = (restaurantId, over = {}) =>
    FoodItem.create({ restaurantId, name: 'Milk', price: 100, stockQty: 50, gstRate: 0, ...over });

const offer = (over = {}) =>
    FoodOffer.create({ couponCode: 'SAVE10', discountType: 'percentage', discountValue: 10, ...over });

const line = (product, quantity = 1) => ({ itemId: String(product._id), quantity });

const daysOut = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

describe('what a coupon takes off', () => {
    it('caps a percentage, floors the rupees, and never exceeds the bill', () => {
        assert.equal(couponDiscountFor({ discountType: 'percentage', discountValue: 10 }, 250), 25);
        assert.equal(couponDiscountFor({ discountType: 'percentage', discountValue: 10, maxDiscount: 20 }, 500), 20, 'capped');
        assert.equal(couponDiscountFor({ discountType: 'percentage', discountValue: 33 }, 100), 33);
        assert.equal(couponDiscountFor({ discountType: 'percentage', discountValue: 7.5 }, 100), 7, 'floored, not rounded');
        assert.equal(couponDiscountFor({ discountType: 'flat-price', discountValue: 50 }, 500), 50);
        assert.equal(couponDiscountFor({ discountType: 'flat-price', discountValue: 500 }, 100), 100, 'a bill cannot go negative');
    });

    it('reads the terms out the way a cashier would', () => {
        assert.equal(describeCoupon({ discountType: 'percentage', discountValue: 20 }), '20% off');
        assert.equal(describeCoupon({ discountType: 'percentage', discountValue: 20, maxDiscount: 100 }), '20% off, up to ₹100');
        assert.equal(describeCoupon({ discountType: 'flat-price', discountValue: 50 }), '₹50 off');
    });
});

describe('when a coupon is refused, and why', () => {
    const shop = String(someId());
    const base = { _id: someId(), status: 'active', discountType: 'flat-price', discountValue: 50 };

    it('names the shortfall, because that is the one a cashier can fix', () => {
        const v = evaluateCoupon({ ...base, minOrderValue: 500 }, { subtotal: 380, restaurantId: shop });
        assert.equal(v.eligible, false);
        assert.match(v.reason, /₹500 minimum/);
        assert.match(v.reason, /₹120 more/);
    });

    it('reports status, dates and scope', () => {
        assert.equal(evaluateCoupon({ ...base, status: 'paused' }, { subtotal: 999 }).reason, 'Paused by admin');
        assert.equal(evaluateCoupon({ ...base, showInCart: false }, { subtotal: 999 }).reason, 'Hidden by admin');
        assert.equal(evaluateCoupon({ ...base, endDate: daysOut(-3) }, { subtotal: 999 }).reason, 'Expired');
        assert.match(evaluateCoupon({ ...base, startDate: daysOut(5) }, { subtotal: 999 }).reason, /^Starts /);
        assert.equal(
            evaluateCoupon({ ...base, restaurantScope: 'selected', restaurantIds: [someId()] }, { subtotal: 999, restaurantId: shop }).reason,
            'Not for this store'
        );
    });

    it('blames the expiry, not the deactivation it caused', () => {
        // The monthly sweep flips an expired campaign to inactive, so both are
        // true at once. "Not active" is not something a cashier can repeat to
        // a customer; "Expired" is.
        const v = evaluateCoupon({ ...base, status: 'inactive', endDate: daysOut(-2) }, { subtotal: 999 });
        assert.equal(v.reason, 'Expired');
    });

    it('treats a midnight end date as through that whole day', () => {
        const endsToday = new Date();
        endsToday.setHours(0, 0, 0, 0);
        const v = evaluateCoupon({ ...base, endDate: endsToday }, { subtotal: 999, now: new Date() });
        assert.equal(v.eligible, true, 'a coupon ending today must still work today');
    });

    it('reports a campaign that is used up', () => {
        assert.equal(
            evaluateCoupon({ ...base, usageLimit: 100, usedCount: 100 }, { subtotal: 999 }).reason,
            'Fully used up'
        );
    });

    it('refuses a percentage so small it rounds to nothing', () => {
        const v = evaluateCoupon({ ...base, discountType: 'percentage', discountValue: 1 }, { subtotal: 50 });
        assert.equal(v.eligible, false);
        assert.match(v.reason, /no discount/);
    });

    it('will not judge a per-customer rule without a customer', () => {
        const forFirstTimers = { ...base, customerScope: 'first-time' };
        assert.equal(
            evaluateCoupon(forFirstTimers, { subtotal: 999, customer: null }).reason,
            'Pick a customer to use this',
            'the pricing engine refuses it too, so offering it would bounce the sale'
        );

        const newCustomer = { id: 'x', orderCount: 0, usedCountByOffer: new Map() };
        assert.equal(evaluateCoupon(forFirstTimers, { subtotal: 999, customer: newCustomer }).eligible, true);

        const regular = { id: 'x', orderCount: 4, usedCountByOffer: new Map() };
        assert.equal(evaluateCoupon(forFirstTimers, { subtotal: 999, customer: regular }).reason, 'First-time customers only');
    });

    it('respects a per-customer usage limit', () => {
        const twice = { ...base, perUserLimit: 2 };
        const used = { id: 'x', orderCount: 9, usedCountByOffer: new Map([[String(base._id), 2]]) };
        assert.equal(evaluateCoupon(twice, { subtotal: 999, customer: used }).reason, 'This customer has used it');

        const onceOnly = { id: 'x', orderCount: 9, usedCountByOffer: new Map([[String(base._id), 1]]) };
        assert.equal(evaluateCoupon(twice, { subtotal: 999, customer: onceOnly }).eligible, true);
    });
});

describe('the till coupon list', () => {
    it('shows this shop\'s coupons with what each is worth on the open bill', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id, { price: 100 });
        await offer({ couponCode: 'FLAT50', discountType: 'flat-price', discountValue: 50 });
        await offer({ couponCode: 'TEN', discountType: 'percentage', discountValue: 10 });

        const { coupons, subtotal } = await pos.listPosCoupons(shop._id, { items: [line(milk, 3)] });
        assert.equal(subtotal, 300);

        const flat = coupons.find((c) => c.code === 'FLAT50');
        const pct = coupons.find((c) => c.code === 'TEN');
        assert.equal(flat.eligible, true);
        assert.equal(flat.discount, 50);
        assert.equal(flat.terms, '₹50 off');
        assert.equal(pct.discount, 30, '10% of 300');
        assert.equal(flat.createdBy, 'Admin');
    });

    it('leaves out another shop\'s coupon but keeps the global ones', async () => {
        const shop = await makeShop();
        const other = await makeShop({ restaurantName: 'Other', ownerPhone: '9000000002', phone: '9000000002' });
        const milk = await makeProduct(shop._id);

        await offer({ couponCode: 'GLOBAL', restaurantScope: 'all' });
        await offer({ couponCode: 'MINE', restaurantScope: 'selected', restaurantIds: [shop._id] });
        await offer({ couponCode: 'THEIRS', restaurantScope: 'selected', restaurantIds: [other._id] });

        const { coupons } = await pos.listPosCoupons(shop._id, { items: [line(milk)] });
        const codes = coupons.map((c) => c.code).sort();
        assert.deepEqual(codes, ['GLOBAL', 'MINE']);
    });

    it('still lists a coupon that does not currently apply, with the reason', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id, { price: 100 });
        await offer({ couponCode: 'BIG', discountType: 'flat-price', discountValue: 200, minOrderValue: 1000 });

        const { coupons } = await pos.listPosCoupons(shop._id, { items: [line(milk, 1)] });
        assert.equal(coupons.length, 1, 'it must not vanish — the cashier has to be able to explain it');
        assert.equal(coupons[0].eligible, false);
        assert.match(coupons[0].reason, /₹900 more/);
    });

    it('separates the coupons that depend on who the customer is', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id, { price: 100 });
        await offer({ couponCode: 'ANYONE', discountType: 'flat-price', discountValue: 10 });
        await offer({ couponCode: 'NEWBIE', discountType: 'flat-price', discountValue: 20, customerScope: 'first-time' });
        await offer({ couponCode: 'ONCE', discountType: 'flat-price', discountValue: 30, perUserLimit: 1 });

        const walkIn = await pos.listPosCoupons(shop._id, { items: [line(milk)] });
        assert.deepEqual(walkIn.coupons.map((c) => c.code), ['ANYONE']);
        assert.deepEqual(walkIn.customerCoupons.map((c) => c.code).sort(), ['NEWBIE', 'ONCE']);
        assert.equal(walkIn.hasCustomer, false);
        assert.ok(walkIn.customerCoupons.every((c) => c.reason === 'Pick a customer to use this'));

        const fresh = await FoodUser.create({ phone: '9811111111', name: 'New' });
        const named = await pos.listPosCoupons(shop._id, { items: [line(milk)], customerId: String(fresh._id) });
        assert.equal(named.hasCustomer, true);
        assert.ok(named.customerCoupons.every((c) => c.eligible), 'a brand new customer qualifies for both');
    });

    it('filters by code', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        await offer({ couponCode: 'DIWALI20' });
        await offer({ couponCode: 'SUMMER5' });

        const { coupons } = await pos.listPosCoupons(shop._id, { items: [line(milk)], search: 'diw' });
        assert.deepEqual(coupons.map((c) => c.code), ['DIWALI20']);
    });

    it('works with an empty cart, marking everything with a minimum as short', async () => {
        const shop = await makeShop();
        await offer({ couponCode: 'NOMIN', discountType: 'flat-price', discountValue: 50 });
        await offer({ couponCode: 'MIN100', discountType: 'flat-price', discountValue: 50, minOrderValue: 100 });

        const { coupons, subtotal } = await pos.listPosCoupons(shop._id, {});
        assert.equal(subtotal, 0);
        assert.equal(coupons.find((c) => c.code === 'MIN100').eligible, false);
        assert.equal(
            coupons.find((c) => c.code === 'NOMIN').eligible,
            false,
            'nothing on the bill means nothing to discount'
        );
    });
});

describe('the list and the bill never disagree', () => {
    it('honours every coupon the list offered, and applies none that it refused', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id, { price: 100 });
        const customer = await FoodUser.create({ phone: '9822222222', name: 'Regular' });

        await offer({ couponCode: 'OK50', discountType: 'flat-price', discountValue: 50 });
        await offer({ couponCode: 'TOOBIG', discountType: 'flat-price', discountValue: 80, minOrderValue: 5000 });
        await offer({ couponCode: 'GONE', discountType: 'flat-price', discountValue: 80, endDate: daysOut(-1) });
        await offer({ couponCode: 'USEDUP', discountType: 'flat-price', discountValue: 80, usageLimit: 1, usedCount: 1 });

        const cart = [line(milk, 3)]; // ₹300
        const { coupons } = await pos.listPosCoupons(shop._id, { items: cart, customerId: String(customer._id) });
        assert.equal(coupons.length, 4, 'all four are listed, whatever their verdict');

        for (const row of coupons) {
            const quote = await pos.quotePosOrder(shop._id, {
                items: cart,
                customerId: String(customer._id),
                couponCode: row.code
            });
            if (row.eligible) {
                assert.equal(
                    quote.pricing.discount, row.discount,
                    `${row.code}: the list promised ₹${row.discount} and the bill gave ₹${quote.pricing.discount}`
                );
                assert.equal(quote.pricing.couponCode, row.code);
            } else {
                assert.equal(
                    quote.pricing.discount, 0,
                    `${row.code}: the list refused it (${row.reason}) but the bill discounted anyway`
                );
            }
        }
    });

    it('agrees about a per-customer limit once it is reached', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id, { price: 100 });
        const customer = await FoodUser.create({ phone: '9833333333', name: 'Repeat' });
        const once = await offer({ couponCode: 'ONCEONLY', discountType: 'flat-price', discountValue: 40, perUserLimit: 1 });

        const cart = [line(milk, 2)];
        const before = await pos.listPosCoupons(shop._id, { items: cart, customerId: String(customer._id) });
        assert.equal(before.customerCoupons[0].eligible, true);
        assert.equal(
            (await pos.quotePosOrder(shop._id, { items: cart, customerId: String(customer._id), couponCode: 'ONCEONLY' })).pricing.discount,
            40
        );

        await FoodOfferUsage.create({ offerId: once._id, userId: customer._id, count: 1 });

        const after = await pos.listPosCoupons(shop._id, { items: cart, customerId: String(customer._id) });
        assert.equal(after.customerCoupons[0].eligible, false);
        assert.equal(after.customerCoupons[0].reason, 'This customer has used it');
        assert.equal(
            (await pos.quotePosOrder(shop._id, { items: cart, customerId: String(customer._id), couponCode: 'ONCEONLY' })).pricing.discount,
            0,
            'the bill must refuse it too'
        );
    });

    it('reads a customer\'s history in two queries however many coupons there are', async () => {
        const customer = await FoodUser.create({ phone: '9844444444', name: 'Someone' });
        const a = await offer({ couponCode: 'A', perUserLimit: 1 });
        const b = await offer({ couponCode: 'B', perUserLimit: 1 });
        await FoodOfferUsage.create({ offerId: a._id, userId: customer._id, count: 1 });
        await FoodOrder.create({
            userId: customer._id,
            restaurantId: someId(),
            items: [{ itemId: String(someId()), name: 'x', price: 10, quantity: 1 }],
            pricing: { subtotal: 10, total: 10 },
            payment: { method: 'cash', status: 'cod_pending' },
            deliveryAddress: { street: 'x', city: 'y', state: 'z', location: { type: 'Point', coordinates: [77.59, 12.97] } },
            orderStatus: 'delivered'
        });

        const facts = await loadCouponCustomerFacts(customer._id, [a._id, b._id]);
        assert.equal(facts.orderCount, 1);
        assert.equal(facts.usedCountByOffer.get(String(a._id)), 1);
        assert.equal(facts.usedCountByOffer.get(String(b._id)), undefined, 'never used is absent, not zero');

        assert.equal(await loadCouponCustomerFacts(null, []), null, 'an anonymous walk-in has no facts');
    });
});
