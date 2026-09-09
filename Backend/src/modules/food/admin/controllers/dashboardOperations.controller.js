import { sendResponse } from '../../../../utils/response.js';
import * as service from '../services/dashboardOperations.service.js';

/** Dashboard: coupons, receivable, payable and the login log. */
const handler = (fn, message) => async (req, res, next) => {
    try {
        return sendResponse(res, 200, message, await fn(req.query || {}));
    } catch (err) {
        next(err);
    }
};

export const getTopCouponsController = handler(service.getTopCoupons, 'Top coupons fetched');
export const getReceivablesController = handler(service.getReceivables, 'Receivables fetched');
export const getPayablesController = handler(service.getPayables, 'Payables fetched');
export const getLoginLogController = handler(service.getLoginLog, 'Login log fetched');
export const getDashboardOperationsController = handler(service.getDashboardOperations, 'Dashboard operations fetched');
