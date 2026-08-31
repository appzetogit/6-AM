import mongoose from 'mongoose';

const productSubscriptionSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true, index: true },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true, index: true },
        itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', required: true },
        itemName: { type: String, default: '' }, // snapshot for display
        variantId: { type: String, default: '' },
        quantity: { type: Number, required: true, min: 1, default: 1 },

        // Recurrence — when the product should be delivered.
        frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
        // Only used when frequency === 'weekly'. 0=Sunday ... 6=Saturday.
        daysOfWeek: { type: [Number], default: [] },
        // Only used when frequency === 'monthly'. 1-28 to stay valid every month.
        dayOfMonth: { type: Number, min: 1, max: 28, default: null },
        // Customer-selected time of day for delivery, "HH:mm" (24h).
        deliveryTime: { type: String, required: true },
        // First scheduled delivery date.
        startDate: { type: Date, required: true },

        addressId: { type: mongoose.Schema.Types.ObjectId, required: true },
        paymentMethod: { type: String, enum: ['cash', 'razorpay', 'wallet'], default: 'cash' },

        status: { type: String, enum: ['active', 'paused', 'cancelled'], default: 'active', index: true },
        // How far ahead occurrences are pre-generated, so the generator job knows
        // where it left off without rescanning every occurrence ever created.
        occurrencesGeneratedUntil: { type: Date, default: null },
    },
    { collection: 'food_product_subscriptions', timestamps: true }
);

productSubscriptionSchema.index({ userId: 1, createdAt: -1 });
productSubscriptionSchema.index({ status: 1, occurrencesGeneratedUntil: 1 });

export const FoodProductSubscription = mongoose.model('FoodProductSubscription', productSubscriptionSchema);
