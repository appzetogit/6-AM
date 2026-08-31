import { sendResponse } from '../../../../utils/response.js';
import {
    createMonthlyList,
    listMonthlyLists,
    getMonthlyList,
    updateMonthlyList,
    deleteMonthlyList,
    placeMonthlyListOrder,
} from '../services/monthlyList.service.js';
import {
    validateCreateMonthlyListDto,
    validateUpdateMonthlyListDto,
    validatePlaceMonthlyListOrderDto,
} from '../validators/monthlyList.validator.js';

export const createMonthlyListController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const dto = validateCreateMonthlyListDto(req.body);
        const result = await createMonthlyList(userId, dto);
        return sendResponse(res, 201, 'Monthly list created successfully', result);
    } catch (err) {
        next(err);
    }
};

export const listMonthlyListsController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const result = await listMonthlyLists(userId);
        return sendResponse(res, 200, 'Monthly lists retrieved successfully', result);
    } catch (err) {
        next(err);
    }
};

export const getMonthlyListController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { listId } = req.params;
        const result = await getMonthlyList(userId, listId);
        return sendResponse(res, 200, 'Monthly list retrieved successfully', result);
    } catch (err) {
        next(err);
    }
};

export const updateMonthlyListController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { listId } = req.params;
        const dto = validateUpdateMonthlyListDto(req.body);
        const result = await updateMonthlyList(userId, listId, dto);
        return sendResponse(res, 200, 'Monthly list updated successfully', result);
    } catch (err) {
        next(err);
    }
};

export const deleteMonthlyListController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { listId } = req.params;
        const result = await deleteMonthlyList(userId, listId);
        return sendResponse(res, 200, 'Monthly list deleted successfully', result);
    } catch (err) {
        next(err);
    }
};

export const placeMonthlyListOrderController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { listId } = req.params;
        const dto = validatePlaceMonthlyListOrderDto(req.body);
        const result = await placeMonthlyListOrder(userId, listId, dto);
        return sendResponse(res, 201, 'Order placed successfully', result);
    } catch (err) {
        next(err);
    }
};
