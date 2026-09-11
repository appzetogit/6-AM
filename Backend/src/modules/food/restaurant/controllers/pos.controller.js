import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    quotePosOrder,
    listPosCoupons,
    createPosOrder,
    recordPosPayment,
    searchPosCustomers,
    getPosCustomerSummary,
    getLastPosBill,
    getPosBill,
    listPosOrders,
    holdPosBill,
    listHeldBills,
    getHeldBillReceipt,
    takeHeldBill,
    discardHeldBill
} from '../services/pos.service.js';

/** Every handler here acts as the signed-in seller, on their own shop only. */
const shopOf = (req) => req.user.userId;

export const quotePosOrderController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Quote ready', await quotePosOrder(shopOf(req), req.body || {}));
    } catch (err) {
        next(err);
    }
};

export const listPosCouponsController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Coupons', await listPosCoupons(shopOf(req), req.body || {}));
    } catch (err) {
        next(err);
    }
};

export const createPosOrderController = async (req, res, next) => {
    try {
        const { items } = req.body || {};
        if (!Array.isArray(items) || !items.length) {
            throw new ValidationError('At least one item is required');
        }
        return sendResponse(res, 201, 'POS order created successfully', await createPosOrder(shopOf(req), req.body || {}));
    } catch (err) {
        next(err);
    }
};

export const recordPosPaymentController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Payment recorded', await recordPosPayment(shopOf(req), req.params.orderId, req.body || {}));
    } catch (err) {
        next(err);
    }
};

export const searchPosCustomersController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Customers', await searchPosCustomers(shopOf(req), req.query.q, req.query.limit));
    } catch (err) {
        next(err);
    }
};

export const getPosCustomerSummaryController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Customer summary', await getPosCustomerSummary(shopOf(req), req.params.customerId));
    } catch (err) {
        next(err);
    }
};

export const getLastPosBillController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Last bill', await getLastPosBill(shopOf(req)));
    } catch (err) {
        next(err);
    }
};

export const getPosBillController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Bill', await getPosBill(shopOf(req), req.params.orderId));
    } catch (err) {
        next(err);
    }
};

export const listPosOrdersController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'POS orders', await listPosOrders(shopOf(req), req.query || {}));
    } catch (err) {
        next(err);
    }
};

export const holdPosBillController = async (req, res, next) => {
    try {
        return sendResponse(res, 201, 'Bill held', await holdPosBill(shopOf(req), req.body || {}));
    } catch (err) {
        next(err);
    }
};

export const listHeldBillsController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Held bills', await listHeldBills(shopOf(req)));
    } catch (err) {
        next(err);
    }
};

export const getHeldBillReceiptController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Held bill', await getHeldBillReceipt(shopOf(req), req.params.heldId));
    } catch (err) {
        next(err);
    }
};

export const takeHeldBillController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Bill resumed', await takeHeldBill(shopOf(req), req.params.heldId));
    } catch (err) {
        next(err);
    }
};

export const discardHeldBillController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Held bill discarded', await discardHeldBill(shopOf(req), req.params.heldId));
    } catch (err) {
        next(err);
    }
};
