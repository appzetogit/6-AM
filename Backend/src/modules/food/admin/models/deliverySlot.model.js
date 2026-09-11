import mongoose from 'mongoose';

/**
 * A window a customer can ask to be delivered in.
 *
 * Rows rather than a settings blob: slots are added, retired and reordered far
 * more often than they are read as a set, and a shop that stops doing the 6am
 * run wants that slot off tomorrow's list without losing the orders already
 * booked into it. Deactivating a row does that; deleting it would orphan them.
 *
 * Times are "HH:mm" in the shop's local day, not instants — a slot is "7 to 8
 * in the morning", every morning, and storing a Date would pin it to one.
 */
const deliverySlotSchema = new mongoose.Schema(
    {
        /** "Morning", "6 – 7 AM" — what the customer picks from. */
        label: { type: String, required: true, trim: true },
        startTime: { type: String, required: true, trim: true },
        endTime: { type: String, required: true, trim: true },

        /**
         * How late an order can be placed and still make this slot, in minutes
         * before it starts. A 6am slot with 120 minutes closes at 4am — the
         * shop needs the night to pick and load it.
         */
        cutoffMinutes: { type: Number, min: 0, default: 60 },

        /**
         * How many orders this slot can take in a day. null means no cap, which
         * is the honest default: a shop that has not thought about capacity
         * should not have one guessed for it.
         */
        capacity: { type: Number, min: 1, default: null },

        /** 0=Sunday … 6=Saturday. Empty means every day. */
        daysOfWeek: { type: [Number], default: [] },

        /** Retired rather than deleted, so orders already in it still resolve. */
        isActive: { type: Boolean, default: true, index: true },

        sortOrder: { type: Number, default: 0 }
    },
    { collection: 'food_delivery_slots', timestamps: true }
);

// The listing: active slots in the order the admin arranged them.
deliverySlotSchema.index({ isActive: 1, sortOrder: 1, startTime: 1 });

export const FoodDeliverySlot = mongoose.model('FoodDeliverySlot', deliverySlotSchema);
