import mongoose from 'mongoose';

const monthlyListItemSchema = new mongoose.Schema(
    {
        itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', required: true },
        variantId: { type: String, default: '' },
        quantity: { type: Number, required: true, min: 1, default: 1 },
        // Snapshot at save-time so the list still shows something sensible if the
        // item is later renamed/removed — re-priced fresh from FoodItem at order time.
        name: { type: String, default: '' },
    },
    { _id: false }
);

const monthlyListSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true, index: true },
        name: { type: String, trim: true, default: 'My Monthly List' },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true, index: true },
        items: { type: [monthlyListItemSchema], default: [] },
        isActive: { type: Boolean, default: true },
        lastOrderedAt: { type: Date, default: null },
        lastOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodOrder', default: null },
    },
    { collection: 'food_monthly_lists', timestamps: true }
);

monthlyListSchema.index({ userId: 1, createdAt: -1 });

export const FoodMonthlyList = mongoose.model('FoodMonthlyList', monthlyListSchema);
