import mongoose from 'mongoose';

const subscriptionOccurrenceSchema = new mongoose.Schema(
    {
        subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodProductSubscription', required: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true, index: true },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true },
        // Calendar date (local midnight) this delivery is scheduled for.
        scheduledDate: { type: Date, required: true, index: true },
        deliveryTime: { type: String, required: true },
        status: {
            type: String,
            enum: ['scheduled', 'cancelled', 'order_placed', 'failed'],
            default: 'scheduled',
            index: true,
        },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodOrder', default: null },
        cancelledAt: { type: Date, default: null },
        cancelReason: { type: String, default: '' },
        failureReason: { type: String, default: '' },
    },
    { collection: 'food_subscription_occurrences', timestamps: true }
);

subscriptionOccurrenceSchema.index({ subscriptionId: 1, scheduledDate: 1 }, { unique: true });
subscriptionOccurrenceSchema.index({ status: 1, scheduledDate: 1 });

export const FoodSubscriptionOccurrence = mongoose.model('FoodSubscriptionOccurrence', subscriptionOccurrenceSchema);
