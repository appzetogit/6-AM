import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectTestDb, disconnectTestDb, resetDb, someId } from './helpers/db.js';
import { FoodOrder } from '../src/modules/food/orders/models/order.model.js';
import { FoodOffer } from '../src/modules/food/admin/models/offer.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodSubscriptionInvoice } from '../src/modules/food/restaurant/models/subscriptionInvoice.model.js';
import { FoodRestaurantWithdrawal } from '../src/modules/food/restaurant/models/foodRestaurantWithdrawal.model.js';
import { FoodLoginAudit } from '../src/core/auth/loginAudit.model.js';
import * as ops from '../src/modules/food/admin/services/dashboardOperations.service.js';
import { describeSystem, clientIpOf, recordLogin } from '../src/core/auth/loginAudit.service.js';

/**
 * The operational dashboard widgets: coupons, money owed both ways, and the
 * login log.
 */

before(connectTestDb);
after(disconnectTestDb);
beforeEach(resetDb);

const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); };
const iso = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const thisMonth = () => { const d = new Date(); return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }; };

const makeOrder = async (over = {}) => {
    const { coupon, total = 100, ...rest } = over;
    return FoodOrder.create({
        userId: someId(),
        restaurantId: someId(),
        items: [{ itemId: String(someId()), name: 'Milk', price: total, quantity: 1 }],
        pricing: { subtotal: total, total, couponCode: coupon ?? null, discount: over.discount ?? 0 },
        payment: { method: 'cash', status: 'cod_pending' },
        deliveryAddress: { street: 'x', city: 'y', state: 'z', location: { type: 'Point', coordinates: [77.59, 12.97] } },
        orderStatus: 'delivered',
        ...rest
    });
};

const makeStore = (name = 'Demo Store') =>
    FoodRestaurant.create({ restaurantName: name, ownerName: 'Owner', ownerPhone: '9000000000', phone: '9000000000' });

describe('top coupons', () => {
    it('ranks coupons by the billing they carried', async () => {
        await makeOrder({ coupon: 'FRESH50', total: 500, discount: 50 });
        await makeOrder({ coupon: 'FRESH50', total: 300, discount: 50 });
        await makeOrder({ coupon: 'SAVE10', total: 200, discount: 10 });
        await makeOrder({ total: 900 }); // no coupon

        const { coupons } = await ops.getTopCoupons(thisMonth());
        assert.equal(coupons.length, 2, 'an order without a coupon must not appear');
        assert.deepEqual(
            coupons.map((c) => [c.couponCode, c.bills, c.totalBillAmount, c.discountGiven]),
            [['FRESH50', 2, 800, 100], ['SAVE10', 1, 200, 10]]
        );
    });

    it('shows the terms from the offer, and still lists a coupon whose offer is gone', async () => {
        await FoodOffer.create({ couponCode: 'FRESH50', discountType: 'flat-price', discountValue: 50 });
        await makeOrder({ coupon: 'FRESH50', total: 500 });
        await makeOrder({ coupon: 'GONE', total: 100 });

        const { coupons } = await ops.getTopCoupons(thisMonth());
        const live = coupons.find((c) => c.couponCode === 'FRESH50');
        const orphan = coupons.find((c) => c.couponCode === 'GONE');

        // An offer has no title field — the code is the name.
        assert.equal(live.couponName, 'FRESH50');
        assert.equal(live.terms, '₹50 off');
        assert.equal(live.status, 'active');

        assert.ok(orphan, 'a deleted offer still shows the business it brought in');
        assert.equal(orphan.status, 'deleted');
        assert.equal(orphan.terms, '');
    });

    it('leaves out cancelled orders', async () => {
        await makeOrder({ coupon: 'FRESH50', total: 500, orderStatus: 'cancelled_by_user' });
        const { coupons } = await ops.getTopCoupons(thisMonth());
        assert.equal(coupons.length, 0);
    });
});

describe('receivables', () => {
    const invoice = (restaurantId, over = {}) =>
        FoodSubscriptionInvoice.create({
            restaurantId,
            billingMonth: '2026-09',
            planName: 'starter',
            planAmount: 1000,
            totalAmount: 1000,
            paidAmount: 0,
            outstandingAmount: 1000,
            status: 'pending',
            periodEnd: today(),
            ...over
        });

    it('reports what is still owed, net of part payments', async () => {
        const store = await makeStore('Alpha Store');
        await invoice(store._id, { totalAmount: 1000, paidAmount: 400, outstandingAmount: 600, status: 'partially_settled' });

        const { items, total } = await ops.getReceivables({});
        assert.equal(items.length, 1);
        assert.equal(items[0].partyName, 'Alpha Store');
        assert.equal(items[0].pendingAmount, 600);
        assert.equal(items[0].invoiceNo, '2026-09');
        assert.equal(total, 600);
    });

    it('uses the invoice own outstanding figure, so a waiver is respected', async () => {
        const store = await makeStore('Waived Store');
        // 1000 billed, 200 paid, 300 waived — 500 is owed, not 800.
        await invoice(store._id, { totalAmount: 1000, paidAmount: 200, waivedAmount: 300, outstandingAmount: 500, status: 'partially_settled' });
        const { items } = await ops.getReceivables({});
        assert.equal(items[0].pendingAmount, 500);
    });

    it('leaves out invoices already settled', async () => {
        const store = await makeStore();
        await invoice(store._id, { status: 'settled', paidAmount: 1000, outstandingAmount: 0, billingMonth: '2026-08' });
        const { items } = await ops.getReceivables({});
        assert.equal(items.length, 0);
    });

    it('narrows to today when asked', async () => {
        const a = await makeStore('Due Today');
        const b = await makeStore('Due Later');
        const later = new Date(); later.setDate(later.getDate() + 20);
        await invoice(a._id, { periodEnd: today() });
        await invoice(b._id, { periodEnd: later, billingMonth: '2026-10' });

        assert.equal((await ops.getReceivables({})).items.length, 2, 'all outstanding by default');
        const scoped = await ops.getReceivables({ today: 'true' });
        assert.equal(scoped.items.length, 1);
        assert.equal(scoped.items[0].partyName, 'Due Today');
        assert.equal(scoped.scope, 'today');
    });
});

describe('payables', () => {
    it('lists pending withdrawal requests and totals them', async () => {
        const store = await makeStore('Alpha Store');
        await FoodRestaurantWithdrawal.create({ restaurantId: store._id, amount: 2500, status: 'pending' });
        await FoodRestaurantWithdrawal.create({ restaurantId: store._id, amount: 700, status: 'approved' });

        const { items, total } = await ops.getPayables({});
        assert.equal(items.length, 1, 'an approved payout is no longer owed');
        assert.equal(items[0].partyName, 'Alpha Store');
        assert.equal(items[0].partyType, 'Seller');
        assert.equal(items[0].pendingAmount, 2500);
        assert.equal(total, 2500);
    });

    it('returns nothing when there is nothing pending', async () => {
        const { items, total } = await ops.getPayables({});
        assert.deepEqual(items, []);
        assert.equal(total, 0);
    });
});

describe('login log', () => {
    it('records a login and reads it back newest first', async () => {
        const older = new Date(Date.now() - 60000);
        await FoodLoginAudit.create({ userId: someId(), role: 'ADMIN', name: 'First', ipAddress: '1.1.1.1', systemDetails: 'Desktop Win10 Chrome', loginAt: older });
        await FoodLoginAudit.create({ userId: someId(), role: 'USER', name: 'Second', ipAddress: '2.2.2.2', systemDetails: 'Mobile Android Chrome', loginAt: new Date() });

        const { logins, total } = await ops.getLoginLog({});
        assert.equal(total, 2);
        assert.equal(logins[0].name, 'Second', 'newest first');
        assert.equal(logins[0].ipAddress, '2.2.2.2');
    });

    it('filters by role', async () => {
        await FoodLoginAudit.create({ userId: someId(), role: 'ADMIN', name: 'A' });
        await FoodLoginAudit.create({ userId: someId(), role: 'USER', name: 'B' });
        const { logins } = await ops.getLoginLog({ role: 'admin' });
        assert.equal(logins.length, 1);
        assert.equal(logins[0].role, 'ADMIN');
    });

    it('never lets an audit failure break a login', async () => {
        // No userId — the row cannot be written, and the caller must not care.
        const result = await recordLogin({ userId: null, role: 'ADMIN' });
        assert.equal(result, null);
        assert.equal(await FoodLoginAudit.countDocuments({}), 0);
    });

    it('stores no token material', async () => {
        await recordLogin({ userId: someId(), role: 'ADMIN', name: 'X', identifier: 'a@b.c', req: null });
        const [row] = await FoodLoginAudit.find({}).lean();
        const text = JSON.stringify(row).toLowerCase();
        assert.ok(!text.includes('token'), 'the audit log must never carry a credential');
    });
});

describe('describeSystem', () => {
    it('names the browser ahead of the ones that impersonate it', () => {
        const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
        const edge = `${chrome} Edg/120`;
        const android = 'Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

        assert.equal(describeSystem(chrome), 'Desktop Win10 Chrome');
        assert.equal(describeSystem(edge), 'Desktop Win10 Edge', 'Edge also claims Chrome');
        assert.equal(describeSystem(android), 'Mobile Android Chrome');
        assert.equal(describeSystem(''), 'Unknown device');
    });
});

describe('clientIpOf', () => {
    it('prefers the forwarded client over the proxy socket', () => {
        assert.equal(
            clientIpOf({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, ip: '10.0.0.1' }),
            '203.0.113.9'
        );
        assert.equal(clientIpOf({ headers: {}, ip: '::ffff:127.0.0.1' }), '127.0.0.1');
        assert.equal(clientIpOf(null), '');
    });
});
