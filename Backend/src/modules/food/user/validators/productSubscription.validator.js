import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'deliveryTime must be HH:mm (24h)');

const createSubscriptionSchema = z.object({
    restaurantId: z.string().min(1, 'restaurantId is required'),
    itemId: z.string().min(1, 'itemId is required'),
    variantId: z.string().optional(),
    quantity: z.number().int().min(1).default(1),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    deliveryTime: timeSchema,
    startDate: z.string().min(1, 'startDate is required'),
    addressId: z.string().min(1, 'addressId is required'),
    paymentMethod: z.enum(['cash', 'razorpay', 'wallet']).optional(),
});

const updateSubscriptionSchema = z.object({
    status: z.enum(['active', 'paused', 'cancelled']).optional(),
    quantity: z.number().int().min(1).optional(),
    deliveryTime: timeSchema.optional(),
    addressId: z.string().optional(),
});

const cancelOccurrenceSchema = z.object({
    reason: z.string().max(300).optional(),
});

const parse = (schema, body) => {
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

export const validateCreateSubscriptionDto = (body) => {
    const data = parse(createSubscriptionSchema, body);
    const startDate = new Date(data.startDate);
    if (Number.isNaN(startDate.getTime())) {
        throw new ValidationError('Invalid startDate');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (startDate < today) {
        throw new ValidationError('startDate cannot be in the past');
    }
    return { ...data, startDate };
};

export const validateUpdateSubscriptionDto = (body) => {
    const data = parse(updateSubscriptionSchema, body);
    if (!Object.keys(data || {}).length) {
        throw new ValidationError('No fields to update');
    }
    return data;
};

export const validateCancelOccurrenceDto = (body) => parse(cancelOccurrenceSchema, body);
