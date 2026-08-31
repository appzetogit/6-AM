import { sendResponse } from '../../../../utils/response.js';
import {
    linkDeliveryPartner,
    unlinkDeliveryPartner,
    listFleet,
    assignDeliveryPartnerManually,
} from '../services/deliveryFleet.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';

export const listFleetController = async (req, res, next) => {
    try {
        const restaurantId = req.user.userId;
        const result = await listFleet(restaurantId);
        return sendResponse(res, 200, 'Fleet retrieved successfully', result);
    } catch (err) {
        next(err);
    }
};

export const linkDeliveryPartnerController = async (req, res, next) => {
    try {
        const restaurantId = req.user.userId;
        const phone = String(req.body?.phone || '').trim();
        if (!phone) throw new ValidationError('phone is required');
        const result = await linkDeliveryPartner(restaurantId, phone);
        return sendResponse(res, 200, 'Delivery partner linked successfully', result);
    } catch (err) {
        next(err);
    }
};

export const unlinkDeliveryPartnerController = async (req, res, next) => {
    try {
        const restaurantId = req.user.userId;
        const { deliveryPartnerId } = req.params;
        const result = await unlinkDeliveryPartner(restaurantId, deliveryPartnerId);
        return sendResponse(res, 200, 'Delivery partner removed from fleet', result);
    } catch (err) {
        next(err);
    }
};

export const assignDeliveryPartnerController = async (req, res, next) => {
    try {
        const restaurantId = req.user.userId;
        const { orderId } = req.params;
        const deliveryPartnerId = String(req.body?.deliveryPartnerId || '').trim();
        if (!deliveryPartnerId) throw new ValidationError('deliveryPartnerId is required');
        const result = await assignDeliveryPartnerManually(restaurantId, orderId, deliveryPartnerId, restaurantId);
        return sendResponse(res, 200, 'Delivery partner assigned successfully', result);
    } catch (err) {
        next(err);
    }
};
