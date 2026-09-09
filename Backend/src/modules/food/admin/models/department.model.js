import mongoose from 'mongoose';

/**
 * Department — the grouping that sits above categories.
 *
 * Retail reads top-down: Department "Grocery" holds category "Dairy" which holds
 * sub-category "Milk". Categories already nest one level via parentId; the
 * department is the floor above that, and is what reporting groups by when a
 * buyer asks how Grocery did against Personal Care.
 *
 * Kept standalone for now. Categories gain an optional departmentId when the
 * product form is rebuilt — adding the pointer before anything writes it would
 * only put an unused field on every existing category.
 */
const foodDepartmentSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, index: true },
        /** Lower-cased name, so uniqueness ignores case without a collation index. */
        nameKey: { type: String, required: true, trim: true, lowercase: true, unique: true },
        /** Short code used on printed reports where the full name will not fit. */
        code: { type: String, trim: true, default: '' },
        description: { type: String, trim: true, default: '' },
        image: { type: String, trim: true, default: '' },
        /**
         * Author, resolved to a name at list time rather than snapshotted, so a
         * renamed admin does not leave stale names scattered across the table.
         */
        createdById: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin', default: null },
        isActive: { type: Boolean, default: true, index: true },
        sortOrder: { type: Number, default: 0 }
    },
    { collection: 'food_departments', timestamps: true }
);

export const FoodDepartment = mongoose.model('FoodDepartment', foodDepartmentSchema);
