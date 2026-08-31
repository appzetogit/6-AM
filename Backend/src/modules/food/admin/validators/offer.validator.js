import { z } from 'zod';
import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';

const createOfferSchema = z.object({
    couponCode: z.string().min(1, 'Coupon code is required'),
    discountType: z.enum(['percentage', 'flat-price']).default('percentage'),
    discountValue: z.number().positive('Discount value must be greater than 0'),
    customerScope: z.enum(['all', 'first-time']).default('all'),
    restaurantScope: z.enum(['all', 'selected']).default('all'),
    restaurantId: z.string().optional(),
    restaurantIds: z.array(z.string()).optional(),
    endDate: z.string().optional().or(z.literal('')).or(z.undefined()),
    startDate: z.string().optional().or(z.literal('')).or(z.undefined()),
    minOrderValue: z.number().min(0).optional(),
    maxDiscount: z.number().min(0).optional(),
    usageLimit: z.number().min(0).optional(),
    perUserLimit: z.number().min(0).optional(),
    isFirstOrderOnly: z.boolean().optional(),
    adminBearPercentage: z.number().min(0).max(100).optional(),
    restaurantBearPercentage: z.number().min(0).max(100).optional(),
    isMonthly: z.boolean().optional(),
    notifyDaysBeforeNextMonth: z.number().min(0).max(60).optional()
});

export const validateCreateOfferDto = (body) => {
    const normalized = {
        ...body,
        couponCode: typeof body?.couponCode === 'string' ? body.couponCode.trim() : body?.couponCode,
        discountType: body?.discountType,
        discountValue: Number(body?.discountValue),
        customerScope: body?.customerScope,
        restaurantScope: body?.restaurantScope,
        restaurantId: body?.restaurantId ? String(body.restaurantId) : undefined,
        restaurantIds: Array.isArray(body?.restaurantIds)
            ? body.restaurantIds.map((id) => String(id)).filter(Boolean)
            : undefined,
        endDate: body?.endDate ? String(body.endDate) : undefined,
        startDate: body?.startDate ? String(body.startDate) : undefined,
        minOrderValue: body?.minOrderValue !== undefined ? Number(body.minOrderValue) : undefined,
        maxDiscount: body?.maxDiscount !== undefined ? Number(body.maxDiscount) : undefined,
        usageLimit: body?.usageLimit !== undefined ? Number(body.usageLimit) : undefined,
        perUserLimit: body?.perUserLimit !== undefined ? Number(body.perUserLimit) : undefined,
        isFirstOrderOnly: body?.isFirstOrderOnly !== undefined ? Boolean(body.isFirstOrderOnly) : undefined,
        adminBearPercentage: body?.adminBearPercentage !== undefined ? Number(body.adminBearPercentage) : undefined,
        restaurantBearPercentage: body?.restaurantBearPercentage !== undefined ? Number(body.restaurantBearPercentage) : undefined,
        isMonthly: body?.isMonthly !== undefined ? Boolean(body.isMonthly) : undefined,
        notifyDaysBeforeNextMonth: body?.notifyDaysBeforeNextMonth !== undefined ? Number(body.notifyDaysBeforeNextMonth) : undefined
    };

    const result = createOfferSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }

    if (result.data.restaurantScope === 'selected') {
        const restaurantIds = [
            ...(result.data.restaurantIds || []),
            ...(result.data.restaurantId ? [result.data.restaurantId] : [])
        ];
        if (restaurantIds.length === 0 || restaurantIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
            throw new ValidationError('At least one valid store is required for selected store scope');
        }
    }

    let endDate = result.data.endDate ? new Date(`${result.data.endDate}T23:59:59.999Z`) : undefined;
    if (endDate && Number.isNaN(endDate.getTime())) {
        throw new ValidationError('Invalid endDate');
    }
    let startDate = result.data.startDate ? new Date(`${result.data.startDate}T00:00:00.000Z`) : undefined;
    if (startDate && Number.isNaN(startDate.getTime())) {
        throw new ValidationError('Invalid startDate');
    }

    // A monthly offer with no explicit window defaults to "the rest of the
    // current calendar month" — renewMonthlyOffers() rolls it forward from there.
    if (result.data.isMonthly && !startDate && !endDate) {
        const now = new Date();
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    if (endDate && startDate && endDate.getTime() <= startDate.getTime()) {
        throw new ValidationError('endDate must be after startDate');
    }
    if (endDate && endDate.getTime() <= Date.now()) {
        throw new ValidationError('endDate must be a future date');
    }
    // Business rule: percentage coupon must have maxDiscount; flat ignores it
    let maxDiscount = result.data.maxDiscount;
    if (result.data.discountType === 'percentage') {
        if (maxDiscount === undefined || maxDiscount === null || Number.isNaN(Number(maxDiscount))) {
            throw new ValidationError('maxDiscount is required for percentage coupons');
        }
        maxDiscount = Math.max(0, Number(maxDiscount) || 0);
    } else {
        maxDiscount = undefined; // ignore for flat-price
    }

    const restaurantIds = result.data.restaurantScope === 'selected'
        ? [...new Set([
            ...(result.data.restaurantIds || []),
            ...(result.data.restaurantId ? [result.data.restaurantId] : [])
        ])]
        : [];
    const adminBearPercentage = result.data.adminBearPercentage ?? 100;
    const restaurantBearPercentage = result.data.restaurantBearPercentage ?? 0;
    if (Math.round((adminBearPercentage + restaurantBearPercentage) * 100) / 100 !== 100) {
        throw new ValidationError('Admin bear and store bear must total 100%');
    }

    return {
        couponCode: result.data.couponCode.trim().toUpperCase(),
        discountType: result.data.discountType,
        discountValue: result.data.discountValue,
        customerScope: result.data.customerScope,
        restaurantScope: result.data.restaurantScope,
        restaurantId: restaurantIds[0],
        restaurantIds,
        endDate,
        startDate,
        minOrderValue: result.data.minOrderValue,
        maxDiscount,
        usageLimit: result.data.usageLimit,
        perUserLimit: result.data.perUserLimit,
        isFirstOrderOnly: result.data.isFirstOrderOnly,
        adminBearPercentage,
        restaurantBearPercentage,
        isMonthly: result.data.isMonthly ?? false,
        notifyDaysBeforeNextMonth: result.data.notifyDaysBeforeNextMonth ?? 23
    };
};

const cartVisibilitySchema = z.object({
    itemId: z.string().min(1, 'itemId is required'),
    showInCart: z.boolean()
});

export const validateUpdateOfferCartVisibilityDto = (body) => {
    const result = cartVisibilitySchema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};
