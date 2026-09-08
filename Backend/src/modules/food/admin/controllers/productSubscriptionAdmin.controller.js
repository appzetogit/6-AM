import { sendResponse } from '../../../../utils/response.js';
import * as service from '../services/productSubscriptionAdmin.service.js';

/** GET /food/admin/product-subscriptions */
export async function listSubscriptionsController(req, res, next) {
    try {
        const data = await service.listSubscriptions(req.query || {});
        return sendResponse(res, 200, 'Subscriptions fetched', data);
    } catch (err) {
        next(err);
    }
}

/** GET /food/admin/product-subscriptions/:id */
export async function getSubscriptionDetailController(req, res, next) {
    try {
        const data = await service.getSubscriptionDetail(req.params.id);
        return sendResponse(res, 200, 'Subscription fetched', data);
    } catch (err) {
        next(err);
    }
}

/** GET /food/admin/subscription-deliveries — one day's board, defaults to today */
export async function listDeliveriesController(req, res, next) {
    try {
        const data = await service.listDeliveries(req.query || {});
        return sendResponse(res, 200, 'Deliveries fetched', data);
    } catch (err) {
        next(err);
    }
}

/** GET /food/admin/subscription-deliveries/summary */
export async function getDeliverySummaryController(req, res, next) {
    try {
        const data = await service.getDeliverySummary(req.query || {});
        return sendResponse(res, 200, 'Summary fetched', data);
    } catch (err) {
        next(err);
    }
}
