import mongoose from 'mongoose';

/**
 * Stock movement ledger — one row per change to an item's `stockQty`.
 *
 * Until this existed, stockQty was a bare number: it went from 40 to 12 and
 * nothing recorded whether that was thirty sales, a miscount, or a bug. Every
 * path that touches stock now appends here, so the Stocks screen can show the
 * history and a Stock Verification can prove what it corrected.
 *
 * Rows are append-only. A mistaken adjustment is fixed by a second adjustment,
 * never by editing the first — a ledger that can be rewritten is not a ledger.
 */
const stockMovementSchema = new mongoose.Schema(
    {
        itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', required: true, index: true },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true, index: true },
        /** Snapshots, so the ledger still reads correctly after the item is renamed or deleted. */
        itemName: { type: String, trim: true, default: '' },
        itemCode: { type: String, trim: true, default: '' },
        /**
         * Why the quantity moved.
         *   opening        – opening stock set on the product form / opening-stock screen
         *   sale           – reserved for an order
         *   sale_return    – order died (cancelled, timed out, payment failed); stock came back
         *   adjustment     – manual +/- from the Stocks screen
         *   verification   – physical count applied from Stock Verification
         *   purchase       – inward from a purchase (reserved for the Purchase module)
         */
        type: {
            type: String,
            enum: ['opening', 'sale', 'sale_return', 'adjustment', 'verification', 'purchase'],
            required: true,
            index: true
        },
        /** Signed change: negative for outward, positive for inward. */
        qtyChange: { type: Number, required: true },
        qtyBefore: { type: Number, default: null },
        qtyAfter: { type: Number, default: null },
        reason: { type: String, trim: true, default: '' },
        note: { type: String, trim: true, default: '' },
        /** What caused it: an order, a verification, or nothing (manual). */
        reference: {
            kind: { type: String, enum: ['order', 'verification', 'manual', 'system'], default: 'manual' },
            id: { type: mongoose.Schema.Types.ObjectId, default: null },
            label: { type: String, trim: true, default: '' }
        },
        createdBy: {
            role: { type: String, trim: true, default: 'SYSTEM' },
            id: { type: mongoose.Schema.Types.ObjectId, default: null },
            name: { type: String, trim: true, default: '' }
        }
    },
    { collection: 'food_stock_movements', timestamps: { createdAt: true, updatedAt: false } }
);

stockMovementSchema.index({ itemId: 1, createdAt: -1 });
stockMovementSchema.index({ restaurantId: 1, createdAt: -1 });
stockMovementSchema.index({ 'reference.kind': 1, 'reference.id': 1 });

export const FoodStockMovement = mongoose.model('FoodStockMovement', stockMovementSchema);
