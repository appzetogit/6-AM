import mongoose from 'mongoose';

import { FoodBrand } from '../models/brand.model.js';
import { FoodUnit } from '../models/unit.model.js';
import { FoodDepartment } from '../models/department.model.js';
import { FoodItem } from '../models/food.model.js';
import { FoodAdmin } from '../../../../core/admin/admin.model.js';
import { NotFoundError, ValidationError } from '../../../../core/auth/errors.js';

/**
 * Product master data: brands (and sub-brands), units of measurement, and
 * departments.
 *
 * These three are grouped because they are the same shape of thing — small,
 * admin-owned lookup tables that the product form's dropdowns read — and
 * because putting them in admin.service.js would add a fourth CRUD trio to a
 * file already past six thousand lines.
 *
 * Deletion is guarded rather than cascading. A category delete can null out the
 * products pointing at it because a product without a category still sells; a
 * brand or unit disappearing from under a product would leave rows referring to
 * something that no longer exists, so the delete is refused and the count of
 * what is in the way is reported instead.
 */

const MAX_LIMIT = 200;

const parsePaging = (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), MAX_LIMIT);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    return { page, limit, skip: (page - 1) * limit };
};

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/** Escapes a user search term so a stray "(" cannot break the regex. */
const searchRegex = (term) =>
    new RegExp(String(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

const toObjectId = (value, label) => {
    if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
        throw new ValidationError(`Invalid ${label}`);
    }
    return new mongoose.Types.ObjectId(String(value));
};

const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const asSortOrder = (value, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;

/**
 * Turns the unique-index violation into the message the admin needs.
 *
 * The index is on nameKey, so Mongo's error names a field the admin never
 * typed; without this they would be told that "nameKey" is taken.
 */
const rethrowDuplicate = (err, label) => {
    if (err?.code === 11000) {
        throw new ValidationError(`A ${label} with this name already exists`);
    }
    throw err;
};

// ─────────────────────────────── Brands ───────────────────────────────

export async function listBrands(query = {}) {
    const { page, limit, skip } = parsePaging(query);
    const filter = {};

    if (query.search && trimmed(query.search)) {
        filter.name = searchRegex(query.search);
    }
    if (query.isActive === 'true') filter.isActive = true;
    if (query.isActive === 'false') filter.isActive = false;

    // `parentId=none` asks for top-level brands only — the list the product
    // form's Brand dropdown shows before a brand is chosen.
    if (query.parentId === 'none') {
        filter.parentId = { $in: [null, undefined] };
    } else if (query.parentId) {
        filter.parentId = toObjectId(query.parentId, 'parentId');
    }

    const [rows, total] = await Promise.all([
        FoodBrand.find(filter).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(limit).lean(),
        FoodBrand.countDocuments(filter)
    ]);

    // One lookup for every parent named by this page, so a sub-brand row can
    // show which brand it belongs to without a query per row.
    const parentIds = [...new Set(rows.map((r) => String(r.parentId || '')).filter(Boolean))];
    const parents = parentIds.length
        ? await FoodBrand.find({ _id: { $in: parentIds } }).select('name').lean()
        : [];
    const parentMap = new Map(parents.map((p) => [String(p._id), p.name]));

    return {
        brands: rows.map((b) => ({
            id: String(b._id),
            _id: b._id,
            name: b.name,
            image: b.image || '',
            code: b.code || '',
            description: b.description || '',
            parentId: b.parentId ? String(b.parentId) : null,
            parentName: b.parentId ? parentMap.get(String(b.parentId)) || null : null,
            isActive: b.isActive !== false,
            sortOrder: b.sortOrder || 0,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt
        })),
        total,
        page,
        limit
    };
}

/** Resolves and validates a parent brand. Returns undefined for a top-level brand. */
const resolveBrandParent = async (parentId, selfId = null) => {
    if (parentId === undefined || parentId === null || parentId === '' || parentId === 'none') {
        return undefined;
    }
    const id = toObjectId(parentId, 'parentId');
    if (selfId && String(id) === String(selfId)) {
        throw new ValidationError('A brand cannot be its own parent');
    }
    const parent = await FoodBrand.findById(id).select('parentId').lean();
    if (!parent) throw new ValidationError('Parent brand not found');
    // One level only — see the note in brand.model.js.
    if (parent.parentId) {
        throw new ValidationError('A sub-brand cannot be the parent of another brand');
    }
    return id;
};

export async function createBrand(body = {}) {
    const name = trimmed(body.name);
    if (!name) throw new ValidationError('Brand name is required');

    try {
        const doc = await FoodBrand.create({
            name,
            nameKey: name.toLowerCase(),
            image: trimmed(body.image),
            code: trimmed(body.code),
            description: trimmed(body.description),
            parentId: await resolveBrandParent(body.parentId),
            isActive: asBool(body.isActive, true),
            sortOrder: asSortOrder(body.sortOrder)
        });
        return doc.toObject();
    } catch (err) {
        return rethrowDuplicate(err, 'brand');
    }
}

export async function updateBrand(id, body = {}) {
    const brandId = toObjectId(id, 'brand id');
    const doc = await FoodBrand.findById(brandId);
    if (!doc) throw new NotFoundError('Brand not found');

    if (body.name !== undefined) {
        const name = trimmed(body.name);
        if (!name) throw new ValidationError('Brand name is required');
        doc.name = name;
        doc.nameKey = name.toLowerCase();
    }
    if (body.image !== undefined) doc.image = trimmed(body.image);
    if (body.code !== undefined) doc.code = trimmed(body.code);
    if (body.description !== undefined) doc.description = trimmed(body.description);
    if (body.isActive !== undefined) doc.isActive = asBool(body.isActive, doc.isActive);
    if (body.sortOrder !== undefined) doc.sortOrder = asSortOrder(body.sortOrder, doc.sortOrder);

    if (body.parentId !== undefined) {
        const nextParent = await resolveBrandParent(body.parentId, brandId);
        // Demoting a brand that has children would orphan them one level down,
        // which the one-level rule does not allow.
        if (nextParent) {
            const childCount = await FoodBrand.countDocuments({ parentId: brandId });
            if (childCount > 0) {
                throw new ValidationError(
                    `This brand has ${childCount} sub-brand(s) and cannot itself become a sub-brand`
                );
            }
        }
        doc.parentId = nextParent;
    }

    try {
        await doc.save();
    } catch (err) {
        return rethrowDuplicate(err, 'brand');
    }
    return doc.toObject();
}

export async function deleteBrand(id) {
    const brandId = toObjectId(id, 'brand id');
    const doc = await FoodBrand.findById(brandId).select('name').lean();
    if (!doc) throw new NotFoundError('Brand not found');

    const childCount = await FoodBrand.countDocuments({ parentId: brandId });
    if (childCount > 0) {
        throw new ValidationError(`Remove this brand's ${childCount} sub-brand(s) first`);
    }

    // Products still carry the brand as free text, so usage is matched by name
    // until the product form moves to brandId.
    const inUse = await FoodItem.countDocuments({ brand: doc.name });
    if (inUse > 0) {
        throw new ValidationError(`${inUse} product(s) use this brand. Reassign them first.`);
    }

    await FoodBrand.deleteOne({ _id: brandId });
    return { id: String(brandId) };
}

export async function toggleBrandStatus(id) {
    const brandId = toObjectId(id, 'brand id');
    const doc = await FoodBrand.findById(brandId);
    if (!doc) throw new NotFoundError('Brand not found');
    doc.isActive = !doc.isActive;
    await doc.save();
    return doc.toObject();
}

// ──────────────────────────────── Units ────────────────────────────────

export async function listUnits(query = {}) {
    const { page, limit, skip } = parsePaging(query);
    const filter = {};

    if (query.search && trimmed(query.search)) {
        const rx = searchRegex(query.search);
        filter.$or = [{ name: rx }, { shortName: rx }];
    }
    if (query.isActive === 'true') filter.isActive = true;
    if (query.isActive === 'false') filter.isActive = false;
    if (query.baseOnly === 'true') filter.baseUnitId = { $in: [null, undefined] };

    const [rows, total] = await Promise.all([
        FoodUnit.find(filter).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(limit).lean(),
        FoodUnit.countDocuments(filter)
    ]);

    const baseIds = [...new Set(rows.map((r) => String(r.baseUnitId || '')).filter(Boolean))];
    const bases = baseIds.length
        ? await FoodUnit.find({ _id: { $in: baseIds } }).select('name shortName').lean()
        : [];
    const baseMap = new Map(bases.map((u) => [String(u._id), u]));

    return {
        units: rows.map((u) => {
            const base = u.baseUnitId ? baseMap.get(String(u.baseUnitId)) : null;
            return {
                id: String(u._id),
                _id: u._id,
                name: u.name,
                shortName: u.shortName,
                decimalPlaces: u.decimalPlaces ?? 0,
                baseUnitId: u.baseUnitId ? String(u.baseUnitId) : null,
                baseUnitName: base?.name || null,
                conversionFactor: u.conversionFactor ?? null,
                // Ready to print: "1 Box = 12 pc".
                conversionLabel: base
                    ? `1 ${u.shortName} = ${u.conversionFactor} ${base.shortName}`
                    : '',
                isActive: u.isActive !== false,
                sortOrder: u.sortOrder || 0,
                createdAt: u.createdAt,
                updatedAt: u.updatedAt
            };
        }),
        total,
        page,
        limit
    };
}

/**
 * Validates the base-unit pairing.
 *
 * Both halves travel together: a base unit without a factor cannot convert, and
 * a factor without a base has nothing to convert into. Accepting either alone
 * would store a conversion that silently does nothing.
 */
const resolveUnitBase = async (body, selfId = null) => {
    const hasBase = body.baseUnitId !== undefined && body.baseUnitId !== null && body.baseUnitId !== '';
    if (!hasBase) {
        return { baseUnitId: undefined, conversionFactor: null };
    }

    const baseId = toObjectId(body.baseUnitId, 'baseUnitId');
    if (selfId && String(baseId) === String(selfId)) {
        throw new ValidationError('A unit cannot convert into itself');
    }

    const base = await FoodUnit.findById(baseId).select('baseUnitId').lean();
    if (!base) throw new ValidationError('Base unit not found');
    if (base.baseUnitId) {
        throw new ValidationError('Base unit must itself be a base unit — conversions are one level deep');
    }

    const factor = Number(body.conversionFactor);
    if (!Number.isFinite(factor) || factor <= 0) {
        throw new ValidationError('conversionFactor must be greater than 0 when a base unit is set');
    }

    return { baseUnitId: baseId, conversionFactor: factor };
};

export async function createUnit(body = {}) {
    const name = trimmed(body.name);
    const shortName = trimmed(body.shortName);
    if (!name) throw new ValidationError('Unit name is required');
    if (!shortName) throw new ValidationError('Unit short name is required');

    const decimalPlaces = Number(body.decimalPlaces);
    if (body.decimalPlaces !== undefined && (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4)) {
        throw new ValidationError('decimalPlaces must be a whole number between 0 and 4');
    }

    const { baseUnitId, conversionFactor } = await resolveUnitBase(body);

    try {
        const doc = await FoodUnit.create({
            name,
            shortName,
            shortNameKey: shortName.toLowerCase(),
            decimalPlaces: body.decimalPlaces === undefined ? 0 : decimalPlaces,
            baseUnitId,
            conversionFactor,
            isActive: asBool(body.isActive, true),
            sortOrder: asSortOrder(body.sortOrder)
        });
        return doc.toObject();
    } catch (err) {
        return rethrowDuplicate(err, 'unit');
    }
}

export async function updateUnit(id, body = {}) {
    const unitId = toObjectId(id, 'unit id');
    const doc = await FoodUnit.findById(unitId);
    if (!doc) throw new NotFoundError('Unit not found');

    if (body.name !== undefined) {
        const name = trimmed(body.name);
        if (!name) throw new ValidationError('Unit name is required');
        doc.name = name;
    }
    if (body.shortName !== undefined) {
        const shortName = trimmed(body.shortName);
        if (!shortName) throw new ValidationError('Unit short name is required');
        doc.shortName = shortName;
        doc.shortNameKey = shortName.toLowerCase();
    }
    if (body.decimalPlaces !== undefined) {
        const dp = Number(body.decimalPlaces);
        if (!Number.isInteger(dp) || dp < 0 || dp > 4) {
            throw new ValidationError('decimalPlaces must be a whole number between 0 and 4');
        }
        doc.decimalPlaces = dp;
    }
    if (body.isActive !== undefined) doc.isActive = asBool(body.isActive, doc.isActive);
    if (body.sortOrder !== undefined) doc.sortOrder = asSortOrder(body.sortOrder, doc.sortOrder);

    if (body.baseUnitId !== undefined || body.conversionFactor !== undefined) {
        // Anything else converting into this one means it is a base, and a base
        // that gains its own base would make the chain two levels deep.
        const dependents = await FoodUnit.countDocuments({ baseUnitId: unitId });
        if (dependents > 0 && body.baseUnitId) {
            throw new ValidationError(
                `${dependents} unit(s) convert into this one, so it must stay a base unit`
            );
        }
        const resolved = await resolveUnitBase(
            {
                baseUnitId: body.baseUnitId !== undefined ? body.baseUnitId : doc.baseUnitId,
                conversionFactor:
                    body.conversionFactor !== undefined ? body.conversionFactor : doc.conversionFactor
            },
            unitId
        );
        doc.baseUnitId = resolved.baseUnitId;
        doc.conversionFactor = resolved.conversionFactor;
    }

    try {
        await doc.save();
    } catch (err) {
        return rethrowDuplicate(err, 'unit');
    }
    return doc.toObject();
}

export async function deleteUnit(id) {
    const unitId = toObjectId(id, 'unit id');
    const doc = await FoodUnit.findById(unitId).select('_id').lean();
    if (!doc) throw new NotFoundError('Unit not found');

    const dependents = await FoodUnit.countDocuments({ baseUnitId: unitId });
    if (dependents > 0) {
        throw new ValidationError(`${dependents} unit(s) convert into this one. Remove them first.`);
    }

    await FoodUnit.deleteOne({ _id: unitId });
    return { id: String(unitId) };
}

export async function toggleUnitStatus(id) {
    const unitId = toObjectId(id, 'unit id');
    const doc = await FoodUnit.findById(unitId);
    if (!doc) throw new NotFoundError('Unit not found');
    doc.isActive = !doc.isActive;
    await doc.save();
    return doc.toObject();
}

// ───────────────────────────── Departments ─────────────────────────────

export async function listDepartments(query = {}) {
    const { page, limit, skip } = parsePaging(query);
    const filter = {};

    if (query.search && trimmed(query.search)) {
        const rx = searchRegex(query.search);
        filter.$or = [{ name: rx }, { code: rx }];
    }
    if (query.isActive === 'true') filter.isActive = true;
    if (query.isActive === 'false') filter.isActive = false;

    const [rows, total] = await Promise.all([
        FoodDepartment.find(filter).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(limit).lean(),
        FoodDepartment.countDocuments(filter)
    ]);

    // One lookup for the "Created By" column, rather than a query per row.
    const authorIds = [...new Set(rows.map((d) => String(d.createdById || '')).filter(Boolean))];
    const authors = authorIds.length
        ? await FoodAdmin.find({ _id: { $in: authorIds } }).select('name email').lean()
        : [];
    const authorMap = new Map(authors.map((a) => [String(a._id), a.name || a.email || '']));

    return {
        departments: rows.map((d) => ({
            id: String(d._id),
            _id: d._id,
            name: d.name,
            createdBy: (d.createdById && authorMap.get(String(d.createdById))) || 'System',
            code: d.code || '',
            description: d.description || '',
            image: d.image || '',
            isActive: d.isActive !== false,
            sortOrder: d.sortOrder || 0,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt
        })),
        total,
        page,
        limit
    };
}

export async function createDepartment(body = {}, user = null) {
    const name = trimmed(body.name);
    if (!name) throw new ValidationError('Department name is required');

    try {
        const doc = await FoodDepartment.create({
            createdById: user?.userId && mongoose.Types.ObjectId.isValid(String(user.userId))
                ? new mongoose.Types.ObjectId(String(user.userId))
                : null,
            name,
            nameKey: name.toLowerCase(),
            code: trimmed(body.code),
            description: trimmed(body.description),
            image: trimmed(body.image),
            isActive: asBool(body.isActive, true),
            sortOrder: asSortOrder(body.sortOrder)
        });
        return doc.toObject();
    } catch (err) {
        return rethrowDuplicate(err, 'department');
    }
}

export async function updateDepartment(id, body = {}) {
    const deptId = toObjectId(id, 'department id');
    const doc = await FoodDepartment.findById(deptId);
    if (!doc) throw new NotFoundError('Department not found');

    if (body.name !== undefined) {
        const name = trimmed(body.name);
        if (!name) throw new ValidationError('Department name is required');
        doc.name = name;
        doc.nameKey = name.toLowerCase();
    }
    if (body.code !== undefined) doc.code = trimmed(body.code);
    if (body.description !== undefined) doc.description = trimmed(body.description);
    if (body.image !== undefined) doc.image = trimmed(body.image);
    if (body.isActive !== undefined) doc.isActive = asBool(body.isActive, doc.isActive);
    if (body.sortOrder !== undefined) doc.sortOrder = asSortOrder(body.sortOrder, doc.sortOrder);

    try {
        await doc.save();
    } catch (err) {
        return rethrowDuplicate(err, 'department');
    }
    return doc.toObject();
}

export async function deleteDepartment(id) {
    const deptId = toObjectId(id, 'department id');
    const doc = await FoodDepartment.findById(deptId).select('_id').lean();
    if (!doc) throw new NotFoundError('Department not found');
    // Nothing points at a department yet; categories gain the link when the
    // product form is rebuilt, and this guard grows a usage check then.
    await FoodDepartment.deleteOne({ _id: deptId });
    return { id: String(deptId) };
}

export async function toggleDepartmentStatus(id) {
    const deptId = toObjectId(id, 'department id');
    const doc = await FoodDepartment.findById(deptId);
    if (!doc) throw new NotFoundError('Department not found');
    doc.isActive = !doc.isActive;
    await doc.save();
    return doc.toObject();
}
