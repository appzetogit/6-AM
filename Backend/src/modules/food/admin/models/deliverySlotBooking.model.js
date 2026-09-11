import mongoose from 'mongoose';

/**
 * The seats taken in one delivery window on one day.
 *
 * Capacity used to be enforced by counting orders and then writing one, which
 * two customers checking out in the same second could both pass — the window
 * ended up with one more order than it can carry. This row is the thing they
 * contend over instead: taking a seat is a single conditional update, so only
 * one of them can be the one that fills the window.
 *
 * It holds order ids rather than a number so it can be repaired. A count that
 * drifts is unfixable; a list can be checked against the orders it names, and
 * cancelled or abandoned entries dropped.
 */
const deliverySlotBookingSchema = new mongoose.Schema(
    {
        slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliverySlot', required: true },
        /** Local midnight of the day being booked. Capacity is a per-day question. */
        day: { type: Date, required: true },
        orderIds: { type: [mongoose.Schema.Types.ObjectId], default: [] }
    },
    { collection: 'food_delivery_slot_bookings', timestamps: true }
);

// One row per window per day — and the thing that makes a full window reject a
// concurrent claim rather than quietly creating a second row.
deliverySlotBookingSchema.index({ slotId: 1, day: 1 }, { unique: true });

export const FoodDeliverySlotBooking = mongoose.model(
    'FoodDeliverySlotBooking',
    deliverySlotBookingSchema
);
