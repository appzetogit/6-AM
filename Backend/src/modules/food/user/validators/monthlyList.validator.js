import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const listItemSchema = z.object({
    itemId: z.string().min(1, 'itemId is required'),
    variantId: z.string().optional(),
    quantity: z.number().int().min(1).default(1),
});

const createListSchema = z.object({
    name: z.string().max(100).optional(),
    restaurantId: z.string().min(1, 'restaurantId is required'),
    items: z.array(listItemSchema).min(1, 'At least one item is required'),
});

const updateListSchema = z.object({
    name: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
    items: z.array(listItemSchema).min(1).optional(),
});

const placeOrderSchema = z.object({
    addressId: z.string().optional(),
    address: z.record(z.any()).optional(),
    paymentMethod: z.enum(['cash', 'razorpay', 'card', 'wallet']).optional(),
    deliveryMode: z.enum(['basic', 'quick']).optional(),
    couponCode: z.string().optional(),
}).refine((data) => data.addressId || data.address, {
    message: 'addressId or address is required',
});

const parse = (schema, body) => {
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

export const validateCreateMonthlyListDto = (body) => parse(createListSchema, body);
export const validateUpdateMonthlyListDto = (body) => {
    const data = parse(updateListSchema, body);
    if (!Object.keys(data || {}).length) {
        throw new ValidationError('No fields to update');
    }
    return data;
};
export const validatePlaceMonthlyListOrderDto = (body) => parse(placeOrderSchema, body);
