import { sendResponse } from '../../../../utils/response.js';
import { createPosOrder } from '../services/pos.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';

export const createPosOrderController = async (req, res, next) => {
    try {
        const restaurantId = req.user.userId;
        const { customerName, customerPhone, items, paymentMethod } = req.body || {};
        if (!Array.isArray(items) || !items.length) {
            throw new ValidationError('At least one item is required');
        }
        const result = await createPosOrder(restaurantId, { customerName, customerPhone, items, paymentMethod });
        return sendResponse(res, 201, 'POS order created successfully', result);
    } catch (err) {
        next(err);
    }
};
