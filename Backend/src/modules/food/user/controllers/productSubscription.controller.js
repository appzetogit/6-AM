import { sendResponse } from '../../../../utils/response.js';
import {
    createSubscription,
    listSubscriptions,
    getSubscription,
    updateSubscription,
    deleteSubscription,
    listOccurrences,
    cancelOccurrence,
} from '../services/productSubscription.service.js';
import {
    validateCreateSubscriptionDto,
    validateUpdateSubscriptionDto,
    validateCancelOccurrenceDto,
} from '../validators/productSubscription.validator.js';

export const createSubscriptionController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const dto = validateCreateSubscriptionDto(req.body);
        const result = await createSubscription(userId, dto);
        return sendResponse(res, 201, 'Subscription created successfully', result);
    } catch (err) {
        next(err);
    }
};

export const listSubscriptionsController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const result = await listSubscriptions(userId);
        return sendResponse(res, 200, 'Subscriptions retrieved successfully', result);
    } catch (err) {
        next(err);
    }
};

export const getSubscriptionController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { subscriptionId } = req.params;
        const result = await getSubscription(userId, subscriptionId);
        return sendResponse(res, 200, 'Subscription retrieved successfully', result);
    } catch (err) {
        next(err);
    }
};

export const updateSubscriptionController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { subscriptionId } = req.params;
        const dto = validateUpdateSubscriptionDto(req.body);
        const result = await updateSubscription(userId, subscriptionId, dto);
        return sendResponse(res, 200, 'Subscription updated successfully', result);
    } catch (err) {
        next(err);
    }
};

export const deleteSubscriptionController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { subscriptionId } = req.params;
        const result = await deleteSubscription(userId, subscriptionId);
        return sendResponse(res, 200, 'Subscription cancelled successfully', result);
    } catch (err) {
        next(err);
    }
};

export const listOccurrencesController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { subscriptionId } = req.params;
        const result = await listOccurrences(userId, subscriptionId);
        return sendResponse(res, 200, 'Scheduled deliveries retrieved successfully', result);
    } catch (err) {
        next(err);
    }
};

export const cancelOccurrenceController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { subscriptionId, occurrenceId } = req.params;
        const dto = validateCancelOccurrenceDto(req.body);
        const result = await cancelOccurrence(userId, subscriptionId, occurrenceId, dto.reason);
        return sendResponse(res, 200, 'Delivery cancelled successfully', result);
    } catch (err) {
        next(err);
    }
};
