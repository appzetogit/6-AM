import mongoose from 'mongoose';

/**
 * Product brand, and its sub-brands.
 *
 * One collection with an optional `parentId` rather than a separate sub-brand
 * collection — the same choice category.model.js makes for sub-categories, and
 * for the same reason: a sub-brand is a brand in every respect that matters
 * (name, logo, active flag), so splitting them would fork every rule twice.
 *
 * Products currently carry a free-text `brand` string. This model is the target
 * that string migrates to; until the product form is switched over, the two
 * coexist and deletion checks match on the name.
 */
const foodBrandSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, index: true },
        /** Lower-cased name, so uniqueness ignores case without a collation index. */
        nameKey: { type: String, required: true, trim: true, lowercase: true, unique: true },
        image: { type: String, trim: true, default: '' },
        /** Short code, mirroring the Category panel beside it. */
        code: { type: String, trim: true, default: '' },
        description: { type: String, trim: true, default: '' },
        /**
         * Parent brand. Set = this is a sub-brand; unset = top-level.
         *
         * Only one level is supported: a sub-brand cannot itself be a parent.
         * Enforced in the service, not here, because the check needs a query.
         */
        parentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodBrand',
            index: true,
            default: undefined
        },
        isActive: { type: Boolean, default: true, index: true },
        sortOrder: { type: Number, default: 0 }
    },
    { collection: 'food_brands', timestamps: true }
);

foodBrandSchema.index({ parentId: 1, isActive: 1 });

export const FoodBrand = mongoose.model('FoodBrand', foodBrandSchema);
