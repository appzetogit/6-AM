import { sendResponse } from '../../../../utils/response.js';
import * as service from '../services/dashboardAnalytics.service.js';

/** Dashboard widgets: top customers, segments, category and product sales. */
const handler = (fn, message) => async (req, res, next) => {
    try {
        return sendResponse(res, 200, message, await fn(req.query || {}));
    } catch (err) {
        next(err);
    }
};

export const getTopCustomersController = handler(service.getTopCustomers, 'Top customers fetched');
export const getCustomerSegmentsController = handler(service.getCustomerSegments, 'Customer segments fetched');
export const getCategorySalesController = handler(service.getCategorySales, 'Category sales fetched');
export const getProductSalesController = handler(service.getProductSales, 'Product sales fetched');
export const getDashboardAnalyticsController = handler(service.getDashboardAnalytics, 'Dashboard analytics fetched');
