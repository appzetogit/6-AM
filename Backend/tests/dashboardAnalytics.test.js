import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectTestDb, disconnectTestDb, resetDb, someId } from './helpers/db.js';
import { FoodOrder } from '../src/modules/food/orders/models/order.model.js';
import { FoodUser } from '../src/core/users/user.model.js';
import * as dash from '../src/modules/food/admin/services/dashboardAnalytics.service.js';

/**
 * Dashboard widgets.
 *
 * The numbers are the product here, so the tests assert arithmetic rather than
 * shape: that a cancelled order is excluded, that profit uses the cost
 * snapshotted on the line, that a line with no cost contributes zero instead of
 * a guess, and that the segment buckets fall on the right side of their windows.
 */

before(connectTestDb);
after(disconnectTestDb);
beforeEach(resetDb);

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const line = (over = {}) => ({
    itemId: String(someId()),
    name: 'Milk',
    price: 100,
    quantity: 1,
    purchasePrice: 60,
    categoryId: someId(),
    categoryName: 'Dairy',
    ...over
});

/** An order that counts as money taken, unless overridden. */
const makeOrder = async (over = {}) => {
    const { items = [line()], total, createdAt = new Date(), ...rest } = over;
    const computed = total ?? items.reduce((s, l) => s + l.price * l.quantity, 0);
    const doc = await FoodOrder.create({
        userId: over.userId || someId(),
        restaurantId: over.restaurantId || someId(),
        items,
        pricing: { subtotal: computed, total: computed },
        payment: { method: 'cash', status: 'cod_pending' },
        deliveryAddress: {
            street: 'x', city: 'y', state: 'z',
            location: { type: 'Point', coordinates: [77.59, 12.97] }
        },
        orderStatus: 'delivered',
        ...rest
    });
    // Backdating goes through the raw driver. The schema sets `timestamps:
    // true`, and Mongoose rewrites createdAt on every update it handles —
    // `{ timestamps: false }` was not enough, the $set was silently undone.
    if (createdAt) {
        await FoodOrder.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
    }
    return doc;
};

const today = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const thisMonth = () => ({ from: today().slice(0, 8) + '01', to: today() });

describe('top customers', () => {
    it('ranks by sales value and counts bills per customer', async () => {
        const big = await FoodUser.create({ phone: '9000000001', name: 'Aryan' });
        const small = await FoodUser.create({ phone: '9000000002', name: 'Bilal' });

        await makeOrder({ userId: big._id, items: [line({ price: 300, quantity: 1 })] });
        await makeOrder({ userId: big._id, items: [line({ price: 266, quantity: 1 })] });
        await makeOrder({ userId: small._id, items: [line({ price: 100, quantity: 1 })] });

        const { customers } = await dash.getTopCustomers(thisMonth());
        assert.equal(customers.length, 2);
        assert.deepEqual(
            customers.map((c) => [c.customerName, c.bills, c.salesValue]),
            [['Aryan', 2, 566], ['Bilal', 1, 100]]
        );
        assert.equal(customers[0].rank, 1);
    });

    it('leaves out cancelled orders', async () => {
        const u = await FoodUser.create({ phone: '9000000003', name: 'Cancelled Only' });
        await makeOrder({ userId: u._id, orderStatus: 'cancelled_by_user' });

        const { customers } = await dash.getTopCustomers(thisMonth());
        assert.equal(customers.length, 0);
    });

    it('leaves out an online order that was never paid', async () => {
        const u = await FoodUser.create({ phone: '9000000004', name: 'Unpaid' });
        await makeOrder({ userId: u._id, orderStatus: 'pending_payment', payment: { method: 'razorpay', status: 'created' } });

        const { customers } = await dash.getTopCustomers(thisMonth());
        assert.equal(customers.length, 0);
    });
});

describe('customer segments', () => {
    it('buckets by recency, with VIP also needing value', async () => {
        const mk = async (name, phone, when, orders, each) => {
            const u = await FoodUser.create({ phone, name });
            for (let i = 0; i < orders; i++) {
                await makeOrder({ userId: u._id, createdAt: when, items: [line({ price: each, quantity: 1 })] });
            }
            return u;
        };

        await mk('Vip', '9100000001', daysAgo(2), 1, 9000);      // recent + big spend
        await mk('Regular', '9100000002', daysAgo(5), 1, 100);   // recent, small
        await mk('Risk', '9100000003', daysAgo(45), 1, 100);     // 30–90 days
        await mk('Lost', '9100000004', daysAgo(200), 1, 100);    // > 90 days

        const { counts, total } = await dash.getCustomerSegments({});
        assert.deepEqual(counts, { vip: 1, regular: 1, risk: 1, lost: 1 });
        assert.equal(total, 4);
    });

    it('counts a frequent buyer as VIP even on small baskets', async () => {
        const u = await FoodUser.create({ phone: '9100000005', name: 'Frequent' });
        for (let i = 0; i < 5; i++) {
            await makeOrder({ userId: u._id, createdAt: daysAgo(3), items: [line({ price: 50, quantity: 1 })] });
        }
        const { counts } = await dash.getCustomerSegments({});
        assert.deepEqual(counts, { vip: 1, regular: 0, risk: 0, lost: 0 });
    });

    it('honours tuned windows', async () => {
        const u = await FoodUser.create({ phone: '9100000006', name: 'Edge' });
        await makeOrder({ userId: u._id, createdAt: daysAgo(45), items: [line({ price: 100 })] });

        assert.equal((await dash.getCustomerSegments({})).counts.risk, 1);
        // Widen "active" past the last order and the same customer is regular.
        assert.equal((await dash.getCustomerSegments({ activeDays: 60 })).counts.regular, 1);
        // Narrow "risk" below it and they are lost.
        assert.equal((await dash.getCustomerSegments({ activeDays: 5, riskDays: 10 })).counts.lost, 1);
    });
});

describe('category sales', () => {
    it('sums quantity, amount and profit per category and shares out the percentage', async () => {
        await makeOrder({
            items: [
                line({ categoryName: 'Dairy', price: 100, quantity: 2, purchasePrice: 60 }),
                line({ categoryName: 'Bakery', price: 50, quantity: 1, purchasePrice: 30 })
            ]
        });
        await makeOrder({ items: [line({ categoryName: 'Dairy', price: 100, quantity: 1, purchasePrice: 60 })] });

        const { categories } = await dash.getCategorySales(thisMonth());
        const dairy = categories.find((c) => c.categoryName === 'Dairy');
        const bakery = categories.find((c) => c.categoryName === 'Bakery');

        assert.equal(dairy.salesQty, 3);
        assert.equal(dairy.salesAmount, 300);
        assert.equal(dairy.profit, 120);           // (100-60) x 3
        assert.equal(bakery.salesAmount, 50);
        assert.equal(bakery.profit, 20);

        assert.equal(dairy.salesPercent, 85.71);   // 300 of 350
        assert.equal(bakery.salesPercent, 14.29);
        assert.equal(Math.round(dairy.salesPercent + bakery.salesPercent), 100);
    });

    it('reports zero profit for a line whose cost was never recorded', async () => {
        await makeOrder({ items: [line({ categoryName: 'Dairy', price: 100, quantity: 2, purchasePrice: null })] });
        const { categories } = await dash.getCategorySales(thisMonth());
        assert.equal(categories[0].salesAmount, 200);
        assert.equal(categories[0].profit, 0, 'an unknown cost is reported as zero, not guessed');
    });

    it('groups lines that carry no category under Uncategorised', async () => {
        await makeOrder({ items: [line({ categoryName: '', categoryId: null, price: 70 })] });
        const { categories } = await dash.getCategorySales(thisMonth());
        assert.equal(categories[0].categoryName, 'Uncategorised');
    });
});

describe('product sales', () => {
    const seedThree = async () => {
        const a = String(someId()), b = String(someId()), c = String(someId());
        // Two separate orders for A, so bills (2) differs from quantity (5).
        await makeOrder({ items: [line({ itemId: a, name: 'ASVAGANDHA TAB', price: 100, quantity: 3, purchasePrice: 70 })] });
        await makeOrder({ items: [line({ itemId: a, name: 'ASVAGANDHA TAB', price: 100, quantity: 2, purchasePrice: 70 })] });
        await makeOrder({ items: [line({ itemId: b, name: 'New Tshirt', price: 157.5, quantity: 1, purchasePrice: 100 })] });
        await makeOrder({ items: [line({ itemId: c, name: 'AAMPACHAK', price: 223, quantity: 1, purchasePrice: 177 })] });
        return { a, b, c };
    };

    it('counts one bill per order however many lines the product had', async () => {
        const { a } = await seedThree();
        const { products } = await dash.getProductSales({ ...thisMonth(), order: 'best' });
        const top = products.find((p) => p.productId === a);
        assert.equal(top.bills, 2);
        assert.equal(top.salesQty, 5);
        assert.equal(top.salesAmount, 500);
        assert.equal(top.profit, 150);   // (100-70) x 5
    });

    it('orders best and least as mirror images of each other', async () => {
        await seedThree();
        const best = await dash.getProductSales({ ...thisMonth(), order: 'best' });
        const least = await dash.getProductSales({ ...thisMonth(), order: 'least' });

        assert.equal(best.order, 'best');
        assert.equal(least.order, 'least');
        assert.equal(best.products[0].productName, 'ASVAGANDHA TAB');
        assert.equal(least.products[0].salesQty, 1);
        assert.equal(best.products.length, least.products.length);
    });

    it('shares the percentage against the whole period, so best and least agree', async () => {
        await seedThree();
        const best = await dash.getProductSales({ ...thisMonth(), order: 'best' });
        const least = await dash.getProductSales({ ...thisMonth(), order: 'least' });

        const byName = (list) => Object.fromEntries(list.products.map((p) => [p.productName, p.salesPercent]));
        assert.deepEqual(byName(best), byName(least), 'the same product must show the same share in both lists');

        const sum = best.products.reduce((s, p) => s + p.salesPercent, 0);
        assert.ok(Math.abs(sum - 100) < 0.05, `shares should total ~100, got ${sum}`);
    });

    it('ignores sales outside the requested range', async () => {
        await makeOrder({ createdAt: daysAgo(400), items: [line({ name: 'Ancient', price: 999 })] });
        const { products } = await dash.getProductSales(thisMonth());
        assert.equal(products.length, 0);
    });
});

describe('getDashboardAnalytics', () => {
    it('returns every widget in one call', async () => {
        const u = await FoodUser.create({ phone: '9200000001', name: 'Aryan' });
        await makeOrder({ userId: u._id, items: [line({ name: 'Milk', price: 283, quantity: 2 })] });

        const all = await dash.getDashboardAnalytics(thisMonth());
        assert.equal(all.topCustomers.customers[0].customerName, 'Aryan');
        assert.equal(all.topCustomers.customers[0].salesValue, 566);
        assert.equal(all.segments.counts.regular, 1);
        assert.equal(all.categorySales.categories.length, 1);
        assert.equal(all.bestSelling.products.length, 1);
        assert.equal(all.leastSelling.products.length, 1);
    });
});
