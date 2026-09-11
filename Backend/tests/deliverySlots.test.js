import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectTestDb, disconnectTestDb, expectError, resetDb, someId } from './helpers/db.js';
import { FoodDeliverySlot } from '../src/modules/food/admin/models/deliverySlot.model.js';
import { FoodOrder } from '../src/modules/food/orders/models/order.model.js';
import { FoodDeliverySlotBooking } from '../src/modules/food/admin/models/deliverySlotBooking.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodRestaurantOutletTimings } from '../src/modules/food/restaurant/models/outletTimings.model.js';
import { assertRestaurantAcceptingOrders } from '../src/modules/food/orders/services/order-pricing.service.js';
import * as slots from '../src/modules/food/admin/services/deliverySlot.service.js';
import { slotStartOn } from '../src/modules/food/admin/services/deliverySlot.service.js';

/**
 * Delivery slots — the windows a customer books instead of "as soon as you can".
 *
 * Two things are worth pinning down here. The first is that a slot the customer
 * can no longer take is still *shown*, with the reason: a screen that silently
 * drops the 7am window teaches them the shop does not deliver then. The second
 * is that instant is not a slot — an order with no slot must keep taking the
 * path it always took, because that is the one nearly every order still uses.
 */

before(connectTestDb);
after(disconnectTestDb);
beforeEach(resetDb);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const makeSlot = (over = {}) =>
    slots.createSlot({ label: 'Morning 7-8', startTime: '07:00', endTime: '08:00', ...over });

/** A date string for N days from now, in the local calendar. */
const dayString = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * A booked order, written straight to the collection.
 *
 * Only the three fields the capacity aggregate reads matter, and a fully valid
 * order would need a shop, items and a priced cart to say nothing about slots.
 */
const bookInto = (slotId, when, status = 'created', _id = someId()) =>
    FoodOrder.collection.insertOne({
        _id,
        deliverySlot: { slotId },
        scheduledAt: when,
        orderStatus: status
    });

describe('defining a slot', () => {
    it('rejects a window that ends before it starts', async () => {
        await expectError(() => makeSlot({ startTime: '09:00', endTime: '08:00' }), 'end after it starts', assert);
    });

    it('rejects an edit that would invert a window one field at a time', async () => {
        const { slot } = await makeSlot();
        // Only endTime is being changed; the check has to read the stored start.
        await expectError(() => slots.updateSlot(slot.id, { endTime: '06:00' }), 'end after it starts', assert);
    });

    it('treats an empty capacity as uncapped rather than zero', async () => {
        const { slot } = await makeSlot({ capacity: '' });
        assert.equal(slot.capacity, null);
    });

    it('refuses a capacity of zero, which would mean a slot nobody can book', async () => {
        await expectError(() => makeSlot({ capacity: 0 }), 'at least 1', assert);
    });

    it('retires a slot instead of deleting it', async () => {
        const { slot } = await makeSlot();
        await slots.deactivateSlot(slot.id);

        // The row survives, so orders already booked into it still read correctly.
        const stored = await FoodDeliverySlot.findById(slot.id).lean();
        assert.ok(stored, 'the slot row should still exist after being retired');
        assert.equal(stored.isActive, false);

        const { slots: visible } = await slots.listSlots();
        assert.equal(visible.length, 0);
        const { slots: all } = await slots.listSlots({ includeInactive: true });
        assert.equal(all.length, 1);
    });
});

describe('a shop that is switched off', () => {
    /**
     * A booked window sets aside the clock, not the shop's own switch. When
     * the whole availability check was skipped for bookings, a shop that had
     * paused orders — closed for the day, rush, an emergency — still took
     * bookings for 7am tomorrow.
     */
    const shopThatIs = (over) => ({
        isActive: true,
        isAcceptingOrders: true,
        outletTimings: { timings: [] },
        ...over
    });

    it('still takes a booking when it is open for business', () => {
        assert.doesNotThrow(() => assertRestaurantAcceptingOrders(shopThatIs({})));
    });

    it('refuses a booking while it has paused orders', () => {
        assert.throws(
            () => assertRestaurantAcceptingOrders(shopThatIs({ isAcceptingOrders: false })),
            /offline/i
        );
    });

    it('refuses a booking once the admin has deactivated it', () => {
        assert.throws(
            () => assertRestaurantAcceptingOrders(shopThatIs({ isActive: false })),
            /closed/i
        );
    });

    it('does not consult the clock, which is the whole point of a window', () => {
        // Shut at 7am by its own hours, and still bookable for the 7am round.
        const earlyBird = shopThatIs({
            outletTimings: {
                timings: DAY_NAMES.map((day) => ({
                    day,
                    isOpen: true,
                    openingTime: '09:00',
                    closingTime: '22:00'
                }))
            }
        });
        assert.doesNotThrow(() => assertRestaurantAcceptingOrders(earlyBird));
    });
});

describe('telling the admin who can serve a window', () => {
    /**
     * Ordering into a window is deliberately not blocked by a shop's counter
     * hours — an early round exists precisely because the counter is shut then.
     * Nothing else would tell an admin that the 3am window they just published
     * is one nobody can serve, so the slots screen says it.
     */
    const makeShop = (over = {}) =>
        FoodRestaurant.create({
            restaurantName: 'Corner Store',
            ownerName: 'Owner',
            ownerPhone: '9000000001',
            phone: '9000000001',
            status: 'approved',
            ...over
        });

    it('counts a shop with no hours on record as keeping standard ones', async () => {
        // The rest of the app reads a missing record as open 09:00–22:00.
        // Reading it as "never open" here would warn on every window.
        await makeShop();
        await makeSlot({ label: 'Midday', startTime: '12:00', endTime: '13:00' });

        const { slots: listed } = await slots.listSlots({ withCoverage: true });
        assert.deepEqual(listed[0].coverage, { open: 1, total: 1 });
    });

    it('reports nobody able to serve a window outside opening hours', async () => {
        await makeShop();
        await makeSlot({ label: 'Dawn', startTime: '03:00', endTime: '04:00' });

        const { slots: listed } = await slots.listSlots({ withCoverage: true });
        assert.deepEqual(listed[0].coverage, { open: 0, total: 1 });
    });

    it('counts a shop open on any one of the days the window runs', async () => {
        const shop = await makeShop();
        await FoodRestaurantOutletTimings.create({
            restaurantId: shop._id,
            timings: [
                { day: 'Monday', isOpen: true, openingTime: '06:00', closingTime: '23:00' },
                { day: 'Tuesday', isOpen: false }
            ]
        });
        // Runs Monday and Tuesday; Monday alone is enough to serve it.
        await makeSlot({ label: 'Early', startTime: '07:00', endTime: '08:00', daysOfWeek: [1, 2] });

        const { slots: listed } = await slots.listSlots({ withCoverage: true });
        assert.deepEqual(listed[0].coverage, { open: 1, total: 1 });
    });

    it('says nothing about coverage unless the screen asks for it', async () => {
        await makeShop();
        await makeSlot();
        const { slots: listed } = await slots.listSlots();
        assert.equal(listed[0].coverage, undefined, 'the customer-facing reads do not pay for this');
    });
});

describe('the slots a customer sees for a day', () => {
    it('only offers slots that run on that weekday', async () => {
        const tomorrow = dayString(1);
        const weekday = new Date(`${tomorrow}T00:00:00`).getDay();
        await makeSlot({ label: 'Runs tomorrow', daysOfWeek: [weekday] });
        await makeSlot({
            label: 'Runs some other day',
            startTime: '09:00',
            endTime: '10:00',
            daysOfWeek: [(weekday + 3) % 7]
        });
        await makeSlot({ label: 'Runs every day', startTime: '11:00', endTime: '12:00' });

        const { slots: offered } = await slots.getAvailableSlots({ date: tomorrow });
        assert.deepEqual(offered.map((s) => s.label).sort(), ['Runs every day', 'Runs tomorrow']);
    });

    it('shows a closed slot with the reason rather than hiding it', async () => {
        await makeSlot({ startTime: '07:00', endTime: '08:00', cutoffMinutes: 60 });
        const today = dayString(0);
        // 06:30 is past the 06:00 cut-off for a 07:00 window.
        const now = new Date(`${today}T06:30:00`);

        const { slots: offered } = await slots.getAvailableSlots({ date: today, now });
        assert.equal(offered.length, 1, 'the slot should still be listed');
        assert.equal(offered[0].available, false);
        assert.match(offered[0].reason, /closed/i);
    });

    it('leaves a slot open before its cut-off', async () => {
        await makeSlot({ startTime: '07:00', endTime: '08:00', cutoffMinutes: 60 });
        const today = dayString(0);
        const { slots: offered } = await slots.getAvailableSlots({
            date: today,
            now: new Date(`${today}T05:30:00`)
        });
        assert.equal(offered[0].available, true);
        assert.equal(offered[0].reason, '');
    });

    it("does not apply today's cut-off to a future day", async () => {
        await makeSlot({ startTime: '07:00', endTime: '08:00', cutoffMinutes: 60 });
        const today = dayString(0);
        // Late tonight — past today's 7am window, but tomorrow's is untouched.
        const now = new Date(`${today}T23:00:00`);
        const { slots: offered } = await slots.getAvailableSlots({ date: dayString(1), now });
        assert.equal(offered[0].available, true);
    });

    it('closes a slot that has reached capacity', async () => {
        const { slot } = await makeSlot({ capacity: 2 });
        const tomorrow = dayString(1);
        const id = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        await bookInto(id, new Date(`${tomorrow}T07:00:00`));
        await bookInto(id, new Date(`${tomorrow}T07:00:00`));

        const { slots: offered } = await slots.getAvailableSlots({ date: tomorrow });
        assert.equal(offered[0].booked, 2);
        assert.equal(offered[0].available, false);
        assert.match(offered[0].reason, /full/i);
    });

    it('frees the place back up when an order is cancelled', async () => {
        const { slot } = await makeSlot({ capacity: 1 });
        const tomorrow = dayString(1);
        const id = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        await bookInto(id, new Date(`${tomorrow}T07:00:00`), 'cancelled_by_user');

        const { slots: offered } = await slots.getAvailableSlots({ date: tomorrow });
        assert.equal(offered[0].booked, 0);
        assert.equal(offered[0].available, true);
    });

    it("counts only the chosen day's bookings against that day's capacity", async () => {
        const { slot } = await makeSlot({ capacity: 1 });
        const id = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        await bookInto(id, new Date(`${dayString(1)}T07:00:00`));

        const { slots: offered } = await slots.getAvailableSlots({ date: dayString(2) });
        assert.equal(offered[0].booked, 0, 'tomorrow being full says nothing about the day after');
    });
});

describe('the last place in a window', () => {
    /**
     * The reason this exists: capacity used to be checked by counting orders and
     * then writing one. Two customers paying in the same second both counted
     * one short of full, both were let in, and the window carried one more
     * order than the van does.
     */
    it('goes to exactly one of two customers paying at the same moment', async () => {
        const { slot } = await makeSlot({ capacity: 1 });
        const tomorrow = dayString(1);
        const slotId = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        const day = new Date(`${tomorrow}T00:00:00`);

        const both = await Promise.all([
            slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId() }),
            slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId() })
        ]);

        assert.deepEqual(both.filter(Boolean).length, 1, 'exactly one claim should succeed');
        assert.deepEqual(both.filter((ok) => !ok).length, 1, 'the other must be told it is full');
    });

    it('lets in exactly as many as the window carries, however they arrive', async () => {
        const { slot } = await makeSlot({ capacity: 3 });
        const slotId = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        const day = new Date(`${dayString(1)}T00:00:00`);

        const claims = await Promise.all(
            Array.from({ length: 8 }, () =>
                slots.claimSlotSeat({ slotId, day, capacity: 3, orderId: someId() })
            )
        );
        assert.equal(claims.filter(Boolean).length, 3);
    });

    it('gives the place back when the order it was taken for never happened', async () => {
        const { slot } = await makeSlot({ capacity: 1 });
        const slotId = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        const day = new Date(`${dayString(1)}T00:00:00`);
        const abandoned = someId();

        assert.equal(await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: abandoned }), true);
        assert.equal(await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId() }), false);

        await slots.releaseSlotSeat({ slotId, day, orderId: abandoned });
        assert.equal(await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId() }), true);
    });

    it('is never refused to a standing arrangement, which takes its place anyway', async () => {
        const { slot } = await makeSlot({ capacity: 1 });
        const slotId = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        const day = new Date(`${dayString(1)}T00:00:00`);

        assert.equal(await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId() }), true);
        // The window it subscribed to was agreed long before today's orders.
        assert.equal(
            await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId(), unconditional: true }),
            true
        );
        // And now it is over-full, so the next one-off booking is turned away.
        assert.equal(await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId() }), false);
    });

    it('records nothing for a window with no limit, which nothing contends over', async () => {
        // Writing an id per order into one document that is never pruned — only
        // capped windows are reconciled — would grow it without bound.
        const { slot } = await makeSlot({ capacity: null });
        const slotId = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        const day = new Date(`${dayString(1)}T00:00:00`);

        for (let i = 0; i < 5; i += 1) {
            assert.equal(await slots.claimSlotSeat({ slotId, day, capacity: null, orderId: someId() }), true);
        }
        assert.equal(await FoodDeliverySlotBooking.countDocuments({ slotId, day }), 0);
    });

    it('starts counting the moment a limit is put on a window', async () => {
        // Nothing was recorded while it was uncapped, so the orders already in
        // it have to be picked up from the orders themselves.
        const { slot } = await makeSlot({ capacity: null });
        const tomorrow = dayString(1);
        const slotId = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        await bookInto(slotId, new Date(`${tomorrow}T07:00:00`));

        await slots.updateSlot(slot.id, { capacity: 1 });
        const listed = await slots.getAvailableSlots({ date: tomorrow });
        assert.equal(listed.slots[0].booked, 1);
        assert.equal(listed.slots[0].available, false);
    });

    it('frees a cancelled order’s place on the next read', async () => {
        const { slot } = await makeSlot({ capacity: 1 });
        const tomorrow = dayString(1);
        const slotId = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        const day = new Date(`${tomorrow}T00:00:00`);

        const orderId = someId();
        await bookInto(slotId, new Date(`${tomorrow}T07:00:00`), 'created', orderId);
        await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId });
        assert.equal((await slots.getAvailableSlots({ date: tomorrow })).slots[0].available, false);

        await FoodOrder.collection.updateOne({ _id: orderId }, { $set: { orderStatus: 'cancelled_by_user' } });

        // Reading the day is what repairs the ledger, so the place is back.
        const after = await slots.getAvailableSlots({ date: tomorrow });
        assert.equal(after.slots[0].booked, 0);
        assert.equal(after.slots[0].available, true);
        assert.equal(await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId() }), true);
    });

    it('counts an order that took the window without claiming a place', async () => {
        // A subscription occurrence written straight into the window, or an
        // order from before this ledger existed. Reading adopts it, so the next
        // booking is measured against it.
        const { slot } = await makeSlot({ capacity: 1 });
        const tomorrow = dayString(1);
        const slotId = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        const day = new Date(`${tomorrow}T00:00:00`);
        await bookInto(slotId, new Date(`${tomorrow}T07:00:00`));

        const listed = await slots.getAvailableSlots({ date: tomorrow });
        assert.equal(listed.slots[0].booked, 1);
        assert.equal(listed.slots[0].available, false);
        assert.equal(await slots.claimSlotSeat({ slotId, day, capacity: 1, orderId: someId() }), false);
    });
});

describe('booking a slot onto an order', () => {
    it('returns the start of the window as the delivery time, with a snapshot', async () => {
        const { slot } = await makeSlot({ label: 'Morning 7-8' });
        const tomorrow = dayString(1);

        const booking = await slots.resolveSlotForOrder(slot.id, { date: tomorrow });
        assert.equal(booking.scheduledAt.getHours(), 7);
        assert.equal(booking.scheduledAt.getMinutes(), 0);
        assert.equal(String(booking.deliverySlot.slotId), slot.id);
        // Snapshotted, so a later rename does not rewrite what the customer booked.
        assert.equal(booking.deliverySlot.label, 'Morning 7-8');
        assert.equal(booking.deliverySlot.startTime, '07:00');
        assert.equal(booking.deliverySlot.endTime, '08:00');
    });

    it('re-checks the cut-off rather than trusting the screen', async () => {
        const { slot } = await makeSlot({ cutoffMinutes: 60 });
        const today = dayString(0);
        // The list was fetched at 05:00 and paid for at 06:30 — by then it is shut.
        await expectError(
            () => slots.resolveSlotForOrder(slot.id, { date: today, now: new Date(`${today}T06:30:00`) }),
            'closed',
            assert
        );
    });

    it('refuses a slot that does not run on the chosen day', async () => {
        const tomorrow = dayString(1);
        const weekday = new Date(`${tomorrow}T00:00:00`).getDay();
        const { slot } = await makeSlot({ daysOfWeek: [(weekday + 2) % 7] });
        await expectError(() => slots.resolveSlotForOrder(slot.id, { date: tomorrow }), 'not available', assert);
    });

    it('refuses a retired slot', async () => {
        const { slot } = await makeSlot();
        await slots.deactivateSlot(slot.id);
        await expectError(() => slots.resolveSlotForOrder(slot.id, { date: dayString(1) }), 'not available', assert);
    });

    it('refuses an id that is not an id', async () => {
        await expectError(() => slots.resolveSlotForOrder('not-an-id', { date: dayString(1) }), 'invalid', assert);
    });

    it('refuses a slot that has been removed outright', async () => {
        await expectError(
            () => slots.resolveSlotForOrder(String(someId()), { date: dayString(1) }),
            'not available',
            assert
        );
    });
});

describe('a standing arrangement', () => {
    it("is not judged against today's cut-off", async () => {
        // A subscription is not competing for tomorrow's 7am van; it is asking to
        // be on every 7am van. Picking one at 6:30pm must still work.
        const { slot } = await makeSlot({ cutoffMinutes: 60 });
        const chosen = await slots.getSlotForSubscription(slot.id);
        assert.equal(chosen.startTime, '07:00');
    });

    it("is not judged against a single day's capacity", async () => {
        const { slot } = await makeSlot({ capacity: 1 });
        const id = (await FoodDeliverySlot.findById(slot.id).lean())._id;
        await bookInto(id, new Date(`${dayString(1)}T07:00:00`));
        const chosen = await slots.getSlotForSubscription(slot.id);
        assert.equal(chosen.id, slot.id);
    });

    it('refuses a retired slot, which nothing should be newly signed up to', async () => {
        const { slot } = await makeSlot();
        await slots.deactivateSlot(slot.id);
        await expectError(() => slots.getSlotForSubscription(slot.id), 'not available', assert);
    });

    /**
     * What each occurrence of a standing arrangement is timed by. The day comes
     * from the occurrence and the time from the window, so a subscribed
     * delivery is scheduled rather than reading as an instant order.
     */
    it('times an occurrence by the day it falls on and the window it was booked into', () => {
        const at = slotStartOn(new Date(2026, 8, 12, 23, 45), '07:00');
        assert.equal(at.getFullYear(), 2026);
        assert.equal(at.getMonth(), 8);
        assert.equal(at.getDate(), 12, 'the day is the occurrence day, not the next one');
        assert.equal(at.getHours(), 7);
        assert.equal(at.getMinutes(), 0);
        assert.equal(at.getSeconds(), 0);
    });

    it('has no time to give when the window was never recorded', () => {
        assert.equal(slotStartOn(new Date(), ''), null);
        assert.equal(slotStartOn('not a date', '07:00'), null);
    });
});
