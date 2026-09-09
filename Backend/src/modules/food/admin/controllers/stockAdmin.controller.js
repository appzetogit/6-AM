import { sendResponse } from '../../../../utils/response.js';
import * as service from '../services/stockAdmin.service.js';

/** Thin wrappers over stockAdmin.service — Stocks list and Stock Verification. */
const handler = (fn, message, status = 200) => async (req, res, next) => {
    try {
        const data = await fn(req);
        return sendResponse(res, status, message, data);
    } catch (err) {
        next(err);
    }
};

// ─── Stocks ───
export const listStocksController = handler((req) => service.listStocks(req.query || {}), 'Stocks fetched');
export const adjustStockController = handler((req) => service.adjustStock(req.body || {}, req.user), 'Stock adjusted');
export const listMovementsController = handler((req) => service.listMovements(req.query || {}), 'Stock movements fetched');
export const listItemMovementsController = handler(
    (req) => service.listMovements({ ...(req.query || {}), itemId: req.params.itemId }),
    'Stock movements fetched'
);

// ─── Stock verification ───
export const listVerificationsController = handler((req) => service.listVerifications(req.query || {}), 'Verifications fetched');
export const createVerificationController = handler((req) => service.createVerification(req.body || {}, req.user), 'Verification created', 201);
export const getVerificationController = handler((req) => service.getVerification(req.params.id), 'Verification fetched');
export const updateVerificationController = handler((req) => service.updateVerification(req.params.id, req.body || {}), 'Verification updated');
export const completeVerificationController = handler((req) => service.completeVerification(req.params.id, req.user), 'Verification completed — stock updated');
export const cancelVerificationController = handler((req) => service.cancelVerification(req.params.id), 'Verification cancelled');
export const deleteVerificationController = handler((req) => service.deleteVerification(req.params.id), 'Verification deleted');
