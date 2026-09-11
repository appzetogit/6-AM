import mongoose from 'mongoose';

import { FoodDeliverySlot } from '../models/deliverySlot.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
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

export async function listSlots({ includeInactive = false } = {}) {
    const filter = includeInactive ? {} : { isActive: true };
    const rows = await FoodDeliverySlot.find(filter).sort({ sortOrder: 1, startTime: 1 }).lean();
    return { slots: rows.map(serialize) };
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

    // One query for the whole day rather than one per slot.
    const booked = forThisDay.some((s) => s.capacity)
        ? await FoodOrder.aggregate([
            {
                $match: {
                    'deliverySlot.slotId': { $in: forThisDay.map((s) => s._id) },
                    scheduledAt: { $gte: day, $lt: new Date(day.getTime() + 86400000) },
                    orderStatus: { $nin: ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'] }
                }
            },
            { $group: { _id: '$deliverySlot.slotId', n: { $sum: 1 } } }
        ])
        : [];
    const bookedBy = new Map(booked.map((b) => [String(b._id), b.n]));

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
