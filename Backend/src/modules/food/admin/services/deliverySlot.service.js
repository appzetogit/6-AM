import mongoose from 'mongoose';

import { FoodDeliverySlot } from '../models/deliverySlot.model.js';
import { FoodDeliverySlotBooking } from '../models/deliverySlotBooking.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodRestaurantOutletTimings } from '../../restaurant/models/outletTimings.model.js';
import { toClientShape } from '../../restaurant/services/outletTimings.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';

/**
 * Delivery slots: the windows a customer can book instead of "as soon as you can".
 *
 * Instant is deliberately not a slot. An order with no slot is an instant order
 * and goes out now — the same path it always took — so nothing about the
 * existing flow had to change to add scheduling beside it.
 */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutesOf = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
};

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

const startOfDay = (date) => {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Reads a YYYY-MM-DD as a local calendar day, not a UTC instant. */
const parseDay = (raw) => {
    if (!raw) return startOfDay(new Date());
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
    if (!m) throw new ValidationError('date must be in YYYY-MM-DD format');
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/** The moment a window opens on a given day: the day, at "HH:mm". */
export const slotStartOn = (date, startTime) => {
    const at = new Date(date);
    if (Number.isNaN(at.getTime())) return null;
    const [h, m] = String(startTime || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    at.setHours(h, m, 0, 0);
    return at;
};

const validate = (dto, { partial = false } = {}) => {
    const out = {};
    const need = (key) => !partial || dto[key] !== undefined;

    if (need('label')) {
        const label = String(dto.label || '').trim();
        if (!label) throw new ValidationError('Slot label is required');
        out.label = label;
    }
    for (const key of ['startTime', 'endTime']) {
        if (!need(key)) continue;
        const value = String(dto[key] || '').trim();
        if (!TIME.test(value)) throw new ValidationError(`${key} must be HH:mm (24h)`);
        out[key] = value;
    }
    if (out.startTime && out.endTime && minutesOf(out.endTime) <= minutesOf(out.startTime)) {
        throw new ValidationError('A slot must end after it starts');
    }
    if (dto.cutoffMinutes !== undefined) {
        const cutoff = Number(dto.cutoffMinutes);
        if (!Number.isFinite(cutoff) || cutoff < 0) throw new ValidationError('cutoffMinutes cannot be negative');
        out.cutoffMinutes = Math.round(cutoff);
    }
    if (dto.capacity !== undefined) {
        if (dto.capacity === null || dto.capacity === '') out.capacity = null;
        else {
            const cap = Number(dto.capacity);
            if (!Number.isInteger(cap) || cap < 1) throw new ValidationError('capacity must be a whole number of at least 1');
            out.capacity = cap;
        }
    }
    if (dto.daysOfWeek !== undefined) {
        const days = Array.isArray(dto.daysOfWeek) ? dto.daysOfWeek.map(Number) : [];
        if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
            throw new ValidationError('daysOfWeek must be numbers 0 (Sunday) to 6 (Saturday)');
        }
        out.daysOfWeek = [...new Set(days)].sort();
    }
    if (dto.isActive !== undefined) out.isActive = dto.isActive !== false;
    if (dto.sortOrder !== undefined) out.sortOrder = Number(dto.sortOrder) || 0;
    return out;
};

const serialize = (slot) => ({
    id: String(slot._id),
    label: slot.label,
    startTime: slot.startTime,
    endTime: slot.endTime,
    cutoffMinutes: slot.cutoffMinutes ?? 60,
    capacity: slot.capacity ?? null,
    daysOfWeek: slot.daysOfWeek || [],
    isActive: slot.isActive !== false,
    sortOrder: slot.sortOrder || 0
});

// ───────────────────────────── admin ─────────────────────────────
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * How many shops keep hours that cover each window.
 *
 * A window is the platform's promise that it delivers then, and ordering into
 * one is deliberately not measured against a shop's counter hours — otherwise
 * an early round, which exists precisely because the counter is shut, could
 * never be ordered. That leaves the admin free to publish 3am with nothing to
 * say nobody can serve it, so this is what the slots screen says it with.
 *
 * Counted as "on at least one day the window runs": a shop closed on Sundays
 * still serves a daily 7am round on the other six.
 */
async function shopCoverageFor(slots) {
    const capable = new Map(slots.map((slot) => [String(slot._id), 0]));
    if (!slots.length) return { coverage: capable, shops: 0 };

    const shops = await FoodRestaurant.find({ status: 'approved' }, { _id: 1 }).lean();
    if (!shops.length) return { coverage: capable, shops: 0 };

    const stored = await FoodRestaurantOutletTimings.find(
        { restaurantId: { $in: shops.map((r) => r._id) } },
        { restaurantId: 1, timings: 1 }
    ).lean();
    const byShop = new Map(stored.map((t) => [String(t.restaurantId), t]));

    // Read through the same defaults the rest of the app uses: a shop with
    // nothing on record keeps standard hours, and treating it as never open
    // would put a warning on every window.
    const weeks = shops.map((shop) => toClientShape(byShop.get(String(shop._id))));

    for (const slot of slots) {
        const runsOn = slot.daysOfWeek?.length ? slot.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
        const opens = minutesOf(slot.startTime);
        const closes = minutesOf(slot.endTime);

        capable.set(
            String(slot._id),
            weeks.filter((week) =>
                runsOn.some((weekday) => {
                    const day = week[WEEKDAY_NAMES[weekday]];
                    if (!day?.isOpen) return false;
                    if (!TIME.test(String(day.openingTime)) || !TIME.test(String(day.closingTime))) return false;
                    return minutesOf(day.openingTime) <= opens && minutesOf(day.closingTime) >= closes;
                })
            ).length
        );
    }

    return { coverage: capable, shops: shops.length };
}

export async function listSlots({ includeInactive = false, withCoverage = false } = {}) {
    const filter = includeInactive ? {} : { isActive: true };
    const rows = await FoodDeliverySlot.find(filter).sort({ sortOrder: 1, startTime: 1 }).lean();
    if (!withCoverage) return { slots: rows.map(serialize) };

    // Only the admin screen asks for this — it is the one that needs telling
    // when a window it just published is one no shop is open for.
    const { coverage, shops } = await shopCoverageFor(rows);
    return {
        slots: rows.map((slot) => ({
            ...serialize(slot),
            coverage: { open: coverage.get(String(slot._id)) || 0, total: shops }
        }))
    };
}

export async function createSlot(dto = {}) {
    const fields = validate(dto);
    if (!fields.startTime || !fields.endTime) throw new ValidationError('startTime and endTime are required');
    const slot = await FoodDeliverySlot.create(fields);
    return { slot: serialize(slot.toObject()) };
}

export async function updateSlot(slotId, dto = {}) {
    if (!isId(slotId)) throw new NotFoundError('Slot not found');
    const fields = validate(dto, { partial: true });
    if (!Object.keys(fields).length) throw new ValidationError('No fields to update');

    // Both ends are checked together even when only one is being changed, or a
    // slot could be edited into ending before it starts one field at a time.
    if (fields.startTime || fields.endTime) {
        const current = await FoodDeliverySlot.findById(slotId).lean();
        if (!current) throw new NotFoundError('Slot not found');
        const start = fields.startTime || current.startTime;
        const end = fields.endTime || current.endTime;
        if (minutesOf(end) <= minutesOf(start)) throw new ValidationError('A slot must end after it starts');
    }

    const slot = await FoodDeliverySlot.findByIdAndUpdate(slotId, { $set: fields }, { new: true }).lean();
    if (!slot) throw new NotFoundError('Slot not found');
    return { slot: serialize(slot) };
}

/**
 * Retires a slot rather than deleting it.
 *
 * Orders already booked into it still name it, and a deleted row would leave
 * them pointing at nothing — the customer's "arriving 7–8am" would become
 * blank on an order that is still coming.
 */
export async function deactivateSlot(slotId) {
    return updateSlot(slotId, { isActive: false });
}

const CANCELLED = ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];

/**
 * How long a claimed seat is held for an order that never got written.
 *
 * A seat is taken a moment before the order row is saved, so for that moment it
 * names an order that does not exist yet. Anything still missing after this is
 * a claim whose order failed on the way in, and the seat goes back.
 */
const ABANDONED_CLAIM_MS = 5 * 60 * 1000;

/**
 * Brings the ledger for a day back in line with the orders it names.
 *
 * The ledger is the thing concurrent bookings contend over, but the orders are
 * the truth. Cancel an order and its seat should free up; this is where that
 * happens, on the next read, along with adopting any slot order that reached
 * the collection without claiming — a subscription's occurrence, say, which is
 * never refused a window but does occupy one.
 *
 * Returns the live order count per slot, which is what `booked` reports.
 */
async function reconcileSeats(slotIds, day) {
    if (!slotIds.length) return new Map();
    const nextDay = new Date(day.getTime() + 86400000);

    const [ledgers, dayOrders] = await Promise.all([
        FoodDeliverySlotBooking.find({ slotId: { $in: slotIds }, day }).lean(),
        FoodOrder.find(
            {
                'deliverySlot.slotId': { $in: slotIds },
                scheduledAt: { $gte: day, $lt: nextDay }
            },
            { _id: 1, orderStatus: 1, 'deliverySlot.slotId': 1 }
        ).lean()
    ]);

    // Every order in the window, and the subset still standing. Both are needed:
    // an id the ledger holds whose order was cancelled gives its place back at
    // once, while one naming no order at all might simply be seconds old.
    const known = new Set(dayOrders.map((o) => String(o._id)));
    const liveBySlot = new Map();
    for (const order of dayOrders) {
        if (CANCELLED.includes(order.orderStatus)) continue;
        const key = String(order.deliverySlot.slotId);
        if (!liveBySlot.has(key)) liveBySlot.set(key, []);
        liveBySlot.get(key).push(order._id);
    }

    const ledgerBySlot = new Map(ledgers.map((l) => [String(l.slotId), l]));
    const abandonedBefore = Date.now() - ABANDONED_CLAIM_MS;
    const writes = [];

    for (const slotId of slotIds) {
        const key = String(slotId);
        const liveIds = liveBySlot.get(key) || [];
        const ledger = ledgerBySlot.get(key);

        if (!ledger) {
            // Nothing has claimed here yet, but orders may already hold the
            // window — a subscription's occurrence, or anything placed before
            // this ledger existed. Record them, so the next booking is measured
            // against them rather than against nothing.
            if (liveIds.length) {
                writes.push({
                    updateOne: {
                        filter: { slotId, day },
                        update: { $setOnInsert: { slotId, day, orderIds: liveIds } },
                        upsert: true
                    }
                });
            }
            continue;
        }

        const liveSet = new Set(liveIds.map(String));
        const held = (ledger.orderIds || []);
        const heldSet = new Set(held.map(String));

        const giveBack = held.filter((id) => {
            if (liveSet.has(String(id))) return false;
            // Cancelled: the place is free now.
            if (known.has(String(id))) return true;
            // No order of that id at all — a claim whose order never landed.
            // Left alone for a few minutes, because it may still be in flight.
            return id.getTimestamp().getTime() < abandonedBefore;
        });
        const adopt = liveIds.filter((id) => !heldSet.has(String(id)));

        // $pull and $addToSet cannot address the same field in one update.
        if (giveBack.length) {
            writes.push({
                updateOne: {
                    filter: { _id: ledger._id },
                    update: { $pull: { orderIds: { $in: giveBack } } }
                }
            });
        }
        if (adopt.length) {
            writes.push({
                updateOne: {
                    filter: { _id: ledger._id },
                    update: { $addToSet: { orderIds: { $each: adopt } } }
                }
            });
        }
    }

    if (writes.length) await FoodDeliverySlotBooking.bulkWrite(writes, { ordered: true });

    return new Map([...liveBySlot].map(([key, ids]) => [key, ids.length]));
}

/**
 * Takes a seat in a window, or reports that it is full.
 *
 * One conditional update decides it: the row is only changed while it holds
 * fewer orders than the window carries, so of two customers paying at the same
 * moment for the last place, exactly one succeeds. The other is told the
 * window is full rather than both being let in.
 *
 * An uncapped window has nothing to contend over and is recorded without a
 * condition, so its ledger still reflects what is booked.
 */
export async function claimSlotSeat({ slotId, day, capacity, orderId, unconditional = false }) {
    // An uncapped window has no last place to fight over, so nothing is
    // recorded for it. Writing anyway would grow one document by an id per
    // order forever — reconciling only ever visits capped windows, so nothing
    // would prune it.
    if (!capacity) return true;

    // The row has to exist before it can be contended over: Mongo will not take
    // a $expr filter on an upsert. Two requests racing to create it is fine —
    // the unique {slotId, day} index means one of them just loses the insert.
    try {
        await FoodDeliverySlotBooking.updateOne(
            { slotId, day },
            { $setOnInsert: { slotId, day, orderIds: [] } },
            { upsert: true }
        );
    } catch (err) {
        if (err?.code !== 11000) throw err;
    }

    // A standing arrangement is not refused its window — it was agreed long
    // before today's orders — but it does take up a place in it.
    const filter = { slotId, day };
    if (capacity && !unconditional) {
        filter.$expr = { $lt: [{ $size: '$orderIds' }, capacity] };
    }

    // One conditional update decides it. Of two customers paying for the last
    // place at the same moment, whichever update lands second no longer matches
    // the size condition and comes back empty.
    const taken = await FoodDeliverySlotBooking.findOneAndUpdate(
        filter,
        { $addToSet: { orderIds: orderId } },
        { new: true }
    ).lean();
    return Boolean(taken);
}

/** Gives a seat back, for an order that never made it to the collection. */
export async function releaseSlotSeat({ slotId, day, orderId }) {
    await FoodDeliverySlotBooking.updateOne({ slotId, day }, { $pull: { orderIds: orderId } });
}

// ───────────────────────────── customer ─────────────────────────────

/**
 * The slots a customer can actually pick for a given day.
 *
 * Every active slot for that weekday is returned, each marked with whether it
 * can still be taken and why not — rather than silently dropping the ones that
 * cannot. A customer looking at 7am on a screen that simply omits it assumes
 * the shop does not deliver then; told "orders close at 5am", they come back
 * tomorrow.
 */
export async function getAvailableSlots({ date, now = new Date() } = {}) {
    const day = parseDay(date);
    const weekday = day.getDay();
    const isToday = startOfDay(now).getTime() === day.getTime();

    const rows = await FoodDeliverySlot.find({ isActive: true }).sort({ sortOrder: 1, startTime: 1 }).lean();
    const forThisDay = rows.filter((s) => !s.daysOfWeek?.length || s.daysOfWeek.includes(weekday));

    // Reading is also when the ledger is repaired: cancelled orders give their
    // seats back, and orders that took a window without claiming are adopted.
    // Only capped windows are worth the work — nothing contends over the rest.
    const capped = forThisDay.filter((s) => s.capacity).map((s) => s._id);
    const bookedBy = await reconcileSeats(capped, day);

    const slots = forThisDay.map((slot) => {
        const starts = new Date(day);
        starts.setHours(...String(slot.startTime).split(':').map(Number), 0, 0);
        const closesAt = new Date(starts.getTime() - (slot.cutoffMinutes ?? 60) * 60000);
        const taken = bookedBy.get(String(slot._id)) || 0;

        let reason = '';
        if (isToday && now >= closesAt) reason = 'Orders for this slot have closed';
        else if (slot.capacity && taken >= slot.capacity) reason = 'This slot is full';

        return {
            ...serialize(slot),
            /** When the order actually lands: the start of the window. */
            deliveryAt: starts,
            ordersClose: closesAt,
            booked: taken,
            available: !reason,
            reason
        };
    });

    return { date: day, slots };
}

/**
 * One active slot, for a standing arrangement rather than a single booking.
 *
 * A subscription is not checked against a cut-off or a day's capacity: it is
 * not competing for tomorrow's 7am van, it is asking to be on every 7am van.
 * Capacity is a per-day question and is answered when each occurrence becomes
 * a real order.
 */
export async function getSlotForSubscription(slotId) {
    if (!isId(slotId)) throw new ValidationError('Invalid delivery slot');
    const slot = await FoodDeliverySlot.findOne({ _id: slotId, isActive: true }).lean();
    if (!slot) throw new ValidationError('That delivery slot is not available');
    return serialize(slot);
}

/**
 * Resolves the slot a customer picked into what the order stores.
 *
 * Re-checks availability here rather than trusting the screen: the list was
 * fetched some minutes ago, and a slot can close or fill between reading it and
 * paying for it.
 */
export async function resolveSlotForOrder(slotId, { date, now = new Date() } = {}) {
    if (!isId(slotId)) throw new ValidationError('Invalid delivery slot');
    const { slots } = await getAvailableSlots({ date, now });
    const slot = slots.find((s) => s.id === String(slotId));
    if (!slot) throw new ValidationError('That delivery slot is not available on the chosen day');
    if (!slot.available) throw new ValidationError(slot.reason);

    return {
        scheduledAt: slot.deliveryAt,
        /** The day and size of the window, so the caller can take a seat in it. */
        day: startOfDay(slot.deliveryAt),
        capacity: slot.capacity ?? null,
        deliverySlot: {
            slotId: new mongoose.Types.ObjectId(slot.id),
            // Snapshotted so a renamed or retired slot still reads correctly on
            // an order that was placed into it.
            label: slot.label,
            startTime: slot.startTime,
            endTime: slot.endTime
        }
    };
}
