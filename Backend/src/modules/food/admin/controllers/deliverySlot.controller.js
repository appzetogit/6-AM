import { sendResponse } from '../../../../utils/response.js';
import * as slots from '../services/deliverySlot.service.js';

/** GET /food/admin/delivery-slots — the admin list, retired ones included. */
export async function listSlotsController(req, res, next) {
    try {
        const data = await slots.listSlots({
            includeInactive: String(req.query.includeInactive) !== 'false',
            // The screen that publishes windows is the one that needs telling
            // when no shop keeps hours covering one.
            withCoverage: String(req.query.withCoverage) === 'true'
        });
        return sendResponse(res, 200, 'Delivery slots', data);
    } catch (err) {
        next(err);
    }
}

export async function createSlotController(req, res, next) {
    try {
        return sendResponse(res, 201, 'Delivery slot created', await slots.createSlot(req.body || {}));
    } catch (err) {
        next(err);
    }
}

export async function updateSlotController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Delivery slot updated', await slots.updateSlot(req.params.slotId, req.body || {}));
    } catch (err) {
        next(err);
    }
}

/** Retires rather than deletes — orders already booked into it still name it. */
export async function deleteSlotController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Delivery slot retired', await slots.deactivateSlot(req.params.slotId));
    } catch (err) {
        next(err);
    }
}

/**
 * GET /food/restaurant/delivery-slots?date=YYYY-MM-DD
 *
 * What the customer can pick, each marked with whether it can still be taken
 * and why not. Mounted with the other public reads rather than under /user,
 * because whether the shop delivers at 7am is worth knowing before signing in.
 */
export async function getAvailableSlotsController(req, res, next) {
    try {
        return sendResponse(res, 200, 'Available slots', await slots.getAvailableSlots({ date: req.query.date }));
    } catch (err) {
        next(err);
    }
}
