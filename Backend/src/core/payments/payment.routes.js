import express from 'express';
import { requireRoles } from '../roles/role.middleware.js';
import {
    getPaymentHistoryController,
    getOrderTransactionsController,
    getUserWalletBalanceController,
    getUserWalletTransactionsController,
    getRestaurantWalletController,
    getDeliveryWalletController,
    getAdminWalletController,
    getAdminFinanceSummaryController,
    listSettlementsController,
    createSettlementController,
    processSettlementController,
    listRefundsController,
    getRefundsByOrderController
} from './payment.controller.js';

const router = express.Router();

/**
 * This router is mounted with authMiddleware but no role guard of its own, so
 * every route below has to state who it is for. It previously stated nothing,
 * which left the /admin endpoints — including the two that move money — open to
 * any signed-in customer, and let the wallet routes read any restaurant's or
 * rider's ledger by putting someone else's id in the path.
 *
 * The order-scoped reads stay open to all four roles because each role has a
 * legitimate view of an order it took part in; the controller is what proves
 * participation.
 */

// ─── Payment history for an order (participants only — enforced in controller) ───
router.get('/orders/:orderId/payments', getPaymentHistoryController);
router.get('/orders/:orderId/transactions', getOrderTransactionsController);
router.get('/orders/:orderId/refunds', getRefundsByOrderController);

// ─── User wallet (new transaction-based endpoints) ───
router.get('/wallet/balance', requireRoles('USER'), getUserWalletBalanceController);
router.get('/wallet/transactions', requireRoles('USER'), getUserWalletTransactionsController);

// ─── Restaurant wallet ───
// A restaurant reads its own (the id comes from its token, not the path); an
// admin may read any.
router.get('/restaurant/:restaurantId/wallet', requireRoles('RESTAURANT', 'ADMIN'), getRestaurantWalletController);

// ─── Delivery partner wallet ───
router.get('/delivery/:deliveryPartnerId/wallet', requireRoles('DELIVERY_PARTNER', 'ADMIN'), getDeliveryWalletController);

// ─── Admin / Finance ───
router.use('/admin', requireRoles('ADMIN'));
router.get('/admin/wallet', getAdminWalletController);
router.get('/admin/finance/summary', getAdminFinanceSummaryController);
router.get('/admin/settlements', listSettlementsController);
router.post('/admin/settlements', createSettlementController);
router.post('/admin/settlements/:id/process', processSettlementController);
router.get('/admin/refunds', listRefundsController);

export default router;
