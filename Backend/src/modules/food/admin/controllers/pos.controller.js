import { sendResponse } from '../../../../utils/response.js';
import {
    createPosOrder,
    holdPosBill,
    listHeldBills,
    takeHeldBill,
    discardHeldBill,
} from '../../restaurant/services/pos.service.js';
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

const requireRestaurantId = (bodyOrQuery = {}) => {
    const restaurantId = String(bodyOrQuery.restaurantId || '').trim();
    if (!restaurantId) throw new ValidationError('restaurantId is required');
    return restaurantId;
};

/** Admin holds are still isolated per restaurant, just like restaurant-side POS. */
export const holdAdminPosBillController = async (req, res, next) => {
    try {
        const restaurantId = requireRestaurantId(req.body);
        return sendResponse(res, 201, 'Bill held', await holdPosBill(restaurantId, req.body || {}));
    } catch (err) {
        next(err);
    }
};

export const listAdminHeldBillsController = async (req, res, next) => {
    try {
        const restaurantId = requireRestaurantId(req.query);
        return sendResponse(res, 200, 'Held bills', await listHeldBills(restaurantId));
    } catch (err) {
        next(err);
    }
};

export const resumeAdminHeldBillController = async (req, res, next) => {
    try {
        const restaurantId = requireRestaurantId(req.body);
        return sendResponse(res, 200, 'Bill resumed', await takeHeldBill(restaurantId, req.params.heldId));
    } catch (err) {
        next(err);
    }
};

export const discardAdminHeldBillController = async (req, res, next) => {
    try {
        const restaurantId = requireRestaurantId(req.query);
        return sendResponse(res, 200, 'Held bill discarded', await discardHeldBill(restaurantId, req.params.heldId));
    } catch (err) {
        next(err);
    }
};
