import { sendResponse } from '../../../../utils/response.js';
import * as service from '../services/productMasters.service.js';

/**
 * Thin wrappers over productMasters.service — the three lookup tables the
 * product form's dropdowns read. Every handler follows the same shape as the
 * rest of the admin controllers: pull input, call the service, hand back a
 * sendResponse envelope, and let errorHandler translate thrown errors.
 */

const handler = (fn, message, status = 200) => async (req, res, next) => {
    try {
        const data = await fn(req, res);
        return sendResponse(res, status, message, data);
    } catch (err) {
        next(err);
    }
};

// ─── Brands ───
export const listBrandsController = handler(
    (req) => service.listBrands(req.query || {}),
    'Brands fetched'
);
export const createBrandController = handler(
    (req) => service.createBrand(req.body || {}),
    'Brand created',
    201
);
export const updateBrandController = handler(
    (req) => service.updateBrand(req.params.id, req.body || {}),
    'Brand updated'
);
export const deleteBrandController = handler(
    (req) => service.deleteBrand(req.params.id),
    'Brand deleted'
);
export const toggleBrandStatusController = handler(
    (req) => service.toggleBrandStatus(req.params.id),
    'Brand status updated'
);

// ─── Units ───
export const listUnitsController = handler(
    (req) => service.listUnits(req.query || {}),
    'Units fetched'
);
export const createUnitController = handler(
    (req) => service.createUnit(req.body || {}),
    'Unit created',
    201
);
export const updateUnitController = handler(
    (req) => service.updateUnit(req.params.id, req.body || {}),
    'Unit updated'
);
export const deleteUnitController = handler(
    (req) => service.deleteUnit(req.params.id),
    'Unit deleted'
);
export const toggleUnitStatusController = handler(
    (req) => service.toggleUnitStatus(req.params.id),
    'Unit status updated'
);

// ─── Departments ───
export const listDepartmentsController = handler(
    (req) => service.listDepartments(req.query || {}),
    'Departments fetched'
);
export const createDepartmentController = handler(
    (req) => service.createDepartment(req.body || {}, req.user),
    'Department created',
    201
);
export const updateDepartmentController = handler(
    (req) => service.updateDepartment(req.params.id, req.body || {}),
    'Department updated'
);
export const deleteDepartmentController = handler(
    (req) => service.deleteDepartment(req.params.id),
    'Department deleted'
);
export const toggleDepartmentStatusController = handler(
    (req) => service.toggleDepartmentStatus(req.params.id),
    'Department status updated'
);
