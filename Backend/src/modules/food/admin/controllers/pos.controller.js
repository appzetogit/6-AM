import { sendResponse } from '../../../../utils/response.js';
import { createPosOrder } from '../../restaurant/services/pos.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/** POST /food/admin/pos/orders — admin rings up a walk-in order on behalf of any restaurant. */
export const createAdminPosOrderController = async (req, res, next) => {
    try {
        const { restaurantId, customerName, customerPhone, items, paymentMethod } = req.body || {};
        if (!restaurantId) {
            throw new ValidationError('restaurantId is required');
        }
        if (!Array.isArray(items) || !items.length) {
            throw new ValidationError('At least one item is required');
        }
        const result = await createPosOrder(restaurantId, { customerName, customerPhone, items, paymentMethod });
        return sendResponse(res, 201, 'POS order created successfully', result);
    } catch (err) {
        next(err);
    }
};
