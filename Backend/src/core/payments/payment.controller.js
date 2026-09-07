import { sendResponse } from '../../utils/response.js';
import { getPaymentsByOrder } from './payment.service.js';
import { getTransactionsByOrder } from './transaction.service.js';
import { getWalletBalance, getWalletWithTransactions, getUserWalletForFrontend } from './wallet.service.js';
import { getRefundsByOrder, listRefunds } from './refund.service.js';
import { createSettlement, processSettlement, listSettlements } from './settlement.service.js';
import { logger } from '../../utils/logger.js';
import { FoodOrder } from '../../modules/food/orders/models/order.model.js';
import { buildOrderIdentityFilter } from '../../modules/food/orders/services/order.helpers.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../auth/errors.js';

/**
 * Resolves an order id from the path and proves the caller took part in it.
 *
 * These routes are addressed by order id alone, so without this any signed-in
 * account could read the payment trail, ledger rows and refunds of any order
 * just by guessing or harvesting an id. Mirrors the participant test already
 * used by getOrderById and the join-tracking socket handler: the customer who
 * placed it, the restaurant that received it, the rider assigned to it — and
 * admins, who legitimately see every order.
 *
 * @returns {Promise<import('mongoose').Types.ObjectId>} the order's _id
 */
const resolveParticipantOrderId = async (orderIdParam, user) => {
    const identity = buildOrderIdentityFilter(orderIdParam);
    if (!identity) throw new ValidationError('Order id required');

    const order = await FoodOrder.findOne(identity)
        .select('userId restaurantId dispatch.deliveryPartnerId')
        .lean();
    if (!order) throw new NotFoundError('Order not found');

    const role = String(user?.role || '').toUpperCase();
    if (role === 'ADMIN') return order._id;

    const me = String(user?.userId || '');
    // For restaurants and riders the token's userId *is* the entity id, the same
    // way the restaurant and delivery order controllers read it.
    const isParticipant =
        (role === 'USER' && String(order.userId || '') === me) ||
        (role === 'RESTAURANT' && String(order.restaurantId || '') === me) ||
        (role === 'DELIVERY_PARTNER' && String(order.dispatch?.deliveryPartnerId || '') === me);

    if (!isParticipant) throw new ForbiddenError('Not your order');
    return order._id;
};

// ─── User Endpoints ───

export const getPaymentHistoryController = async (req, res, next) => {
    try {
        const orderId = await resolveParticipantOrderId(req.params.orderId, req.user);
        const payments = await getPaymentsByOrder(orderId);
        return sendResponse(res, 200, 'Payment history fetched', { payments });
    } catch (err) {
        next(err);
    }
};

export const getOrderTransactionsController = async (req, res, next) => {
    try {
        const orderId = await resolveParticipantOrderId(req.params.orderId, req.user);
        const transactions = await getTransactionsByOrder(orderId);
        return sendResponse(res, 200, 'Transactions fetched', { transactions });
    } catch (err) {
        next(err);
    }
};

export const getUserWalletBalanceController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const data = await getWalletBalance('user', userId);
        return sendResponse(res, 200, 'Balance fetched', data);
    } catch (err) {
        next(err);
    }
};

export const getUserWalletTransactionsController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const data = await getWalletWithTransactions('user', userId, { page, limit });
        return sendResponse(res, 200, 'Wallet transactions fetched', data);
    } catch (err) {
        next(err);
    }
};

// ─── Restaurant Endpoints ───

/**
 * The entity whose wallet may be read: an admin may name any in the path, every
 * other role is pinned to its own id from the token.
 *
 * This used to read `req.user.restaurantId || req.params.restaurantId`, but
 * authMiddleware only ever sets userId/role/adminType — so that first operand
 * was always undefined and the path parameter always won, letting any caller
 * read any restaurant's or rider's ledger.
 */
const resolveOwnWalletId = (req) => {
    const role = String(req.user?.role || '').toUpperCase();
    if (role === 'ADMIN') {
        const fromPath = req.params.restaurantId || req.params.deliveryPartnerId;
        if (!fromPath) throw new ValidationError('Entity id required');
        return fromPath;
    }
    // For these roles the token's userId is the entity id.
    return String(req.user?.userId || '');
};

export const getRestaurantWalletController = async (req, res, next) => {
    try {
        const restaurantId = resolveOwnWalletId(req);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const data = await getWalletWithTransactions('restaurant', restaurantId, { page, limit });
        return sendResponse(res, 200, 'Store wallet fetched', data);
    } catch (err) {
        next(err);
    }
};

// ─── Delivery Partner Endpoints ───

export const getDeliveryWalletController = async (req, res, next) => {
    try {
        const deliveryPartnerId = resolveOwnWalletId(req);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const data = await getWalletWithTransactions('deliveryBoy', deliveryPartnerId, { page, limit });
        return sendResponse(res, 200, 'Delivery wallet fetched', data);
    } catch (err) {
        next(err);
    }
};

// ─── Admin Endpoints ───

export const getAdminWalletController = async (req, res, next) => {
    try {
        const data = await getWalletBalance('admin', 'platform');
        return sendResponse(res, 200, 'Admin wallet fetched', data);
    } catch (err) {
        next(err);
    }
};

export const getAdminFinanceSummaryController = async (req, res, next) => {
    try {
        const { FoodAdminWallet } = await import('../../modules/food/admin/models/adminWallet.model.js');
        const adminWallet = await FoodAdminWallet.findOne({ key: 'platform' }).lean();
        const pendingSettlements = await listSettlements({ status: 'pending', limit: 100 });
        const pendingRefunds = await listRefunds({ status: 'pending', limit: 100 });

        return sendResponse(res, 200, 'Finance summary', {
            platform: {
                balance: adminWallet?.balance || 0,
                totalRevenue: adminWallet?.totalRevenue || 0,
                totalPayouts: adminWallet?.totalPayouts || 0,
                totalRefunds: adminWallet?.totalRefunds || 0
            },
            pendingSettlements: {
                count: pendingSettlements.total,
                totalAmount: pendingSettlements.settlements.reduce((s, v) => s + (v.amount || 0), 0)
            },
            pendingRefunds: {
                count: pendingRefunds.total,
                totalAmount: pendingRefunds.refunds.reduce((s, v) => s + (v.amount || 0), 0)
            }
        });
    } catch (err) {
        next(err);
    }
};

export const listSettlementsController = async (req, res, next) => {
    try {
        const { entityType, entityId, status } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const data = await listSettlements({ entityType, entityId, status, page, limit });
        return sendResponse(res, 200, 'Settlements fetched', data);
    } catch (err) {
        next(err);
    }
};

export const createSettlementController = async (req, res, next) => {
    try {
        const { entityType, entityId, amount, notes, periodStart, periodEnd } = req.body;
        const settlement = await createSettlement({ entityType, entityId, amount, notes, periodStart, periodEnd });
        return sendResponse(res, 201, 'Settlement created', { settlement });
    } catch (err) {
        next(err);
    }
};

export const processSettlementController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const adminId = req.user?.userId;
        const { payoutRef } = req.body;
        const settlement = await processSettlement(id, { processedBy: adminId, payoutRef });
        return sendResponse(res, 200, 'Settlement processed', { settlement });
    } catch (err) {
        next(err);
    }
};

export const listRefundsController = async (req, res, next) => {
    try {
        const { status } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const data = await listRefunds({ status, page, limit });
        return sendResponse(res, 200, 'Refunds fetched', data);
    } catch (err) {
        next(err);
    }
};

export const getRefundsByOrderController = async (req, res, next) => {
    try {
        const orderId = await resolveParticipantOrderId(req.params.orderId, req.user);
        const refunds = await getRefundsByOrder(orderId);
        return sendResponse(res, 200, 'Refunds fetched', { refunds });
    } catch (err) {
        next(err);
    }
};
