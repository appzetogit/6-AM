import mongoose from 'mongoose';

/**
 * Stock verification — a physical count of a store's shelf, compared against
 * what the system believes is there.
 *
 * Lifecycle: draft (counting in progress, book quantities snapshotted at
 * creation) -> completed (every line's stockQty is set to the counted figure and
 * a `verification` movement is written for each difference) or cancelled.
 *
 * Book quantities are snapshotted rather than read live, because a sale during
 * the count would otherwise make the "difference" column lie about what the
 * counter actually found.
 */
const verificationLineSchema = new mongoose.Schema(
    {
        itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', required: true },
        itemCode: { type: String, trim: true, default: '' },
        itemName: { type: String, trim: true, default: '' },
        unitShortName: { type: String, trim: true, default: '' },
        /** stockQty when the line was added. null = the item was untracked at the time. */
        bookQty: { type: Number, default: null },
        /** What was physically counted. null until entered. */
        countedQty: { type: Number, default: null, min: 0 },
        note: { type: String, trim: true, default: '' }
    },
    { _id: true }
);

const stockVerificationSchema = new mongoose.Schema(
    {
        /** "STV0000000012", from the shared counter. */
        verificationNo: { type: String, required: true, unique: true, index: true },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true, index: true },
        status: { type: String, enum: ['draft', 'completed', 'cancelled'], default: 'draft', index: true },
        items: { type: [verificationLineSchema], default: [] },
        note: { type: String, trim: true, default: '' },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin', default: null },
        completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin', default: null },
        completedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null }
    },
    { collection: 'food_stock_verifications', timestamps: true }
);

stockVerificationSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });

export const FoodStockVerification = mongoose.model('FoodStockVerification', stockVerificationSchema);
