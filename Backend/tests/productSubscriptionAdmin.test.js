import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectTestDb, disconnectTestDb, expectError, resetDb, someId } from './helpers/db.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodUser } from '../src/core/users/user.model.js';
import { FoodProductSubscription } from '../src/modules/food/user/models/productSubscription.model.js';
import { FoodSubscriptionOccurrence } from '../src/modules/food/user/models/subscriptionOccurrence.model.js';
import * as admin from '../src/modules/food/admin/services/productSubscriptionAdmin.service.js';
import { getCustomerAddresses } from '../src/modules/food/admin/services/admin.service.js';

/**
 * Admin starting a subscription for a customer who phoned the shop.
 *
 * The point of these is that the phone route and the app route stay the same
 * arrangement: the admin write delegates to the customer-facing service, so
 * every rule the app enforces has to still bite here. Each refusal below is
 * one of those rules, checked from the admin side.
 */

before(connectTestDb);
after(disconnectTestDb);
beforeEach(resetDb);

const iso = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = () => iso(new Date());
const daysFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return iso(d);
};

const makeShop = (over = {}) =>
    FoodRestaurant.create({
        restaurantName: 'Dairy Corner',
        ownerName: 'Owner',
        ownerPhone: '9000000001',
        phone: '9000000001',
        status: 'approved',
        ...over
    });

const makeProduct = (restaurantId, over = {}) =>
    FoodItem.create({ restaurantId, name: 'Amul Gold 1L', price: 68, stockQty: 100, subscriptionEnabled: true, ...over });

const makeCustomer = async (over = {}) => {
    const { withAddress = true, ...rest } = over;
    return FoodUser.create({
        phone: '9800000001',
        name: 'Ravi Kumar',
        addresses: withAddress
            ? [{
                label: 'Home',
                flatNumber: '12B',
                street: 'MG Road',
                city: 'Bengaluru',
                state: 'Karnataka',
                zipCode: '560001',
                phone: '9800000001',
                isDefault: true,
                location: { type: 'Point', coordinates: [77.59, 12.97] }
            }]
            : [],
        ...rest
    });
};

/** The body the admin form posts. */
const body = (customer, item, over = {}) => ({
    customerId: String(customer._id),
    restaurantId: String(item.restaurantId),
    itemId: String(item._id),
    quantity: 1,
    frequency: 'daily',
    deliveryTime: '06:00',
    startDate: today(),
    addressId: String(customer.addresses[0]._id),
    paymentMethod: 'cash',
    ...over
});

describe('admin creates a subscription', () => {
    it('sets up the standing arrangement and pre-generates its deliveries', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();

        const { subscription } = await admin.createSubscriptionForCustomer(
            body(customer, milk, { quantity: 2, deliveryTime: '06:30' })
        );

        assert.equal(subscription.customer.name, 'Ravi Kumar');
        assert.equal(subscription.customer.phone, '9800000001');
        assert.equal(subscription.restaurantName, 'Dairy Corner');
        assert.equal(subscription.itemName, 'Amul Gold 1L', 'the name is snapshotted at signup');
        assert.equal(subscription.quantity, 2);
        assert.equal(subscription.frequency, 'daily');
        assert.equal(subscription.deliveryTime, '06:30');
        assert.equal(subscription.status, 'active');

        const saved = await FoodProductSubscription.findById(subscription.id).lean();
        assert.equal(String(saved.userId), String(customer._id), 'it belongs to the customer, not the admin');

        // A daily subscription is pre-generated over a rolling two-week horizon.
        const occurrences = await FoodSubscriptionOccurrence.find({ subscriptionId: subscription.id }).sort({ scheduledDate: 1 }).lean();
        assert.ok(occurrences.length >= 14, `expected a fortnight of deliveries, got ${occurrences.length}`);
        assert.equal(occurrences[0].status, 'scheduled');
        assert.equal(occurrences[0].deliveryTime, '06:30');
        assert.equal(String(occurrences[0].userId), String(customer._id));
    });

    it('shows up in the admin list exactly as the form left it', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();
        await admin.createSubscriptionForCustomer(body(customer, milk));

        const { subscriptions, total } = await admin.listSubscriptions({});
        assert.equal(total, 1);
        assert.equal(subscriptions[0].customer.phone, '9800000001');
        assert.equal(subscriptions[0].itemName, 'Amul Gold 1L');

        // And it is findable the way someone searches when that customer rings back.
        const byPhone = await admin.listSubscriptions({ search: '9800000001' });
        assert.equal(byPhone.total, 1);
        const byItem = await admin.listSubscriptions({ search: 'amul' });
        assert.equal(byItem.total, 1);
    });

    it('carries a weekly rule through with its days', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();

        const { subscription } = await admin.createSubscriptionForCustomer(
            body(customer, milk, { frequency: 'weekly', daysOfWeek: [1, 4] })
        );
        assert.deepEqual(subscription.daysOfWeek, [1, 4]);

        const occurrences = await FoodSubscriptionOccurrence.find({ subscriptionId: subscription.id }).lean();
        assert.ok(occurrences.length > 0, 'a weekly subscription still gets a schedule');
        assert.ok(
            occurrences.every((o) => [1, 4].includes(new Date(o.scheduledDate).getDay())),
            'every generated delivery falls on a chosen weekday'
        );
    });

    it('carries a monthly rule through with its day', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();

        const { subscription } = await admin.createSubscriptionForCustomer(
            body(customer, milk, { frequency: 'monthly', dayOfMonth: 5 })
        );
        assert.equal(subscription.dayOfMonth, 5);
        assert.deepEqual(subscription.daysOfWeek, [], 'the weekly field is cleared, not carried over');
    });
});

describe('the rules the app enforces still bite from the admin side', () => {
    it('refuses a product the seller has not made subscribable', async () => {
        const shop = await makeShop();
        const notSubscribable = await makeProduct(shop._id, { name: 'Birthday Cake', subscriptionEnabled: false });
        const customer = await makeCustomer();

        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, notSubscribable)),
            'not available for subscription',
            assert
        );
        assert.equal(await FoodProductSubscription.countDocuments({}), 0);
    });

    it('refuses a product belonging to a different shop', async () => {
        const shop = await makeShop();
        const other = await makeShop({ restaurantName: 'Other Shop', ownerPhone: '9000000002', phone: '9000000002' });
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();

        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, milk, { restaurantId: String(other._id) })),
            'does not belong to this restaurant',
            assert
        );
    });

    it('refuses an address that is not this customer\'s', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();
        const stranger = await makeCustomer({ phone: '9800000002', name: 'Someone Else' });

        await expectError(
            () => admin.createSubscriptionForCustomer(
                body(customer, milk, { addressId: String(stranger.addresses[0]._id) })
            ),
            'Saved address not found',
            assert
        );
    });

    it('refuses a start date in the past', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();

        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, milk, { startDate: daysFromNow(-1) })),
            'cannot be in the past',
            assert
        );
    });

    it('refuses a weekly rule with no days and a monthly rule with no day', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();

        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, milk, { frequency: 'weekly' })),
            'daysOfWeek is required',
            assert
        );
        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, milk, { frequency: 'monthly' })),
            'dayOfMonth is required',
            assert
        );
    });

    it('refuses a delivery time that is not HH:mm', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();

        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, milk, { deliveryTime: '6am' })),
            'HH:mm',
            assert
        );
    });
});

describe('the customer the admin names', () => {
    it('has to exist', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer();

        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, milk, { customerId: String(someId()) })),
            'Customer not found',
            assert
        );
        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, milk, { customerId: 'not-an-id' })),
            'Invalid customerId',
            assert
        );
    });

    it('cannot be a deactivated account', async () => {
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        const customer = await makeCustomer({ isActive: false });

        await expectError(
            () => admin.createSubscriptionForCustomer(body(customer, milk)),
            'deactivated',
            assert
        );
    });
});

describe('the address picker', () => {
    it('lists a customer\'s addresses as one readable line each', async () => {
        const customer = await makeCustomer();
        const { customer: who, addresses } = await getCustomerAddresses(customer._id);

        assert.equal(who.name, 'Ravi Kumar');
        assert.equal(addresses.length, 1);
        assert.equal(addresses[0].label, 'Home');
        assert.equal(addresses[0].line, '12B, MG Road, Bengaluru, Karnataka, 560001');
        assert.equal(addresses[0].isDefault, true);
        assert.equal(addresses[0].hasLocation, true);
    });

    it('flags a legacy address with no coordinates, because an order cannot be written to one', async () => {
        // Such a row cannot be created through the schema any more: Mongoose
        // fills in location.type = 'Point', and the 2dsphere index rejects a
        // Point with no position. It only exists in rows written before
        // coordinates were captured, which have no location key at all — so
        // that is what the driver writes here.
        const id = someId();
        await FoodUser.collection.insertOne({
            _id: id,
            phone: '9800000003',
            name: 'No Pin',
            role: 'USER',
            isActive: true,
            addresses: [{
                _id: someId(),
                label: 'Office',
                street: 'Somewhere',
                city: 'Bengaluru',
                state: 'Karnataka',
                zipCode: '560002'
            }]
        });

        const { addresses } = await getCustomerAddresses(id);
        assert.equal(addresses[0].hasLocation, false, 'the form must be able to grey this one out');
        assert.equal(addresses[0].line, 'Somewhere, Bengaluru, Karnataka, 560002');
    });

    it('returns nothing for a customer who does not exist', async () => {
        assert.equal(await getCustomerAddresses(someId()), null);
        assert.equal(await getCustomerAddresses('not-an-id'), null);
    });
});
