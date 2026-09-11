import mongoose from 'mongoose';

/**
 * A bill parked mid-sale.
 *
 * The customer stepped away to fetch something, a second customer needs
 * serving, or the card machine is busy: the cashier holds the bill and starts
 * a fresh one. Nothing here has touched stock or the ledger — that happens
 * only when the bill is resumed and actually paid — so a hold is a saved cart,
 * not an order, and it lives in its own collection rather than as a phantom
 * order status that every report would have to remember to exclude.
 *
 * Held lines snapshot the price the cashier saw so the totals strip shows the
 * same figures on resume; the real charge is still recomputed from the
 * catalogue at payment time, as for every order.
 */
const heldLineSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, trim: true, default: '' },
        variantId: { type: String, trim: true, default: '' },
        price: { type: Number, min: 0, default: 0 },
        quantity: { type: Number, min: 1, default: 1 },
        discount: { type: Number, min: 0, default: 0 },
        /** Snapshotted so the printed slip can carry a tax summary. */
        gstRate: { type: Number, min: 0, max: 100, default: null }
    },
    { _id: false }
);

const posHeldBillSchema = new mongoose.Schema(
    {
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true, index: true },
        /**
         * "HOLD7" — what the printed slip carries and what a cashier reads out
         * to find the bill again. Sequential per shop, from an atomic counter:
         * counting the existing holds and adding one would hand the same
         * number to two tills at once.
         */
        holdNo: { type: String, trim: true, default: '', index: true },
        customer: {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', default: null },
            name: { type: String, trim: true, default: '' },
            phone: { type: String, trim: true, default: '' }
        },
        orderType: {
            type: String,
            enum: ['dine_in', 'take_away', 'walk_in', 'delivery'],
            default: 'walk_in'
        },
        tableNo: { type: String, trim: true, default: '' },
        salesman: { type: String, trim: true, default: '' },
        remarks: { type: String, trim: true, default: '' },
        items: { type: [heldLineSchema], default: [] },
        flatDiscount: {
            type: { type: String, enum: ['percent', 'flat'], default: 'percent' },
            value: { type: Number, min: 0, default: 0 }
        },
        additionalCharges: { type: Number, min: 0, default: 0 },
        roundOff: { type: Boolean, default: false },
        couponCode: { type: String, trim: true, uppercase: true, default: '' },
        /** What the strip showed when it was held, for the list's Amount column. */
        estimatedTotal: { type: Number, min: 0, default: 0 },
        /**
         * The quote as it stood when the bill was parked.
         *
         * A hold has been charged nothing, and catalogue prices can move before
         * it is resumed — so the slip in the customer's hand shows what they
         * were quoted, while the sale itself is still priced fresh at payment.
         */
        pricing: {
            subtotal: { type: Number, default: 0 },
            tax: { type: Number, default: 0 },
            discount: { type: Number, default: 0 },
            additionalCharges: { type: Number, default: 0 },
            roundOff: { type: Number, default: 0 },
            total: { type: Number, default: 0 }
        },
        heldBy: { type: String, trim: true, default: '' }
    },
    { collection: 'food_pos_held_bills', timestamps: true }
);

posHeldBillSchema.index({ restaurantId: 1, createdAt: -1 });

export const FoodPosHeldBill = mongoose.model('FoodPosHeldBill', posHeldBillSchema);
