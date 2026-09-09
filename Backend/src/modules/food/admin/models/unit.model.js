import mongoose from 'mongoose';

/**
 * Unit of measurement.
 *
 * Groceries are sold in more than one unit of the same product — a carton that
 * holds twelve bottles is still bottles on the shelf — so a unit has to be able
 * to say what it is worth in another. `baseUnitId` + `conversionFactor` express
 * that: "Box, base Piece, factor 12" means one Box is twelve Pieces.
 *
 * A unit with no baseUnitId is itself a base unit and is worth one of itself.
 * Chains are deliberately one level deep: allowing Box -> Case -> Pallet would
 * make every stock calculation a graph walk, and the arithmetic is far easier to
 * trust when every unit resolves to its base in a single multiply.
 *
 * `decimalPlaces` is what stops "0.5 Piece". Weight and volume divide, counted
 * things do not, and inventory that allows half a bottle is inventory nobody
 * trusts.
 */
const foodUnitSchema = new mongoose.Schema(
    {
        /** Full name shown in dropdowns: "Kilogram", "Piece", "Box". */
        name: { type: String, required: true, trim: true, index: true },
        /** Printed next to quantities: "kg", "pc", "box". */
        shortName: { type: String, required: true, trim: true },
        /** Lower-cased shortName; uniqueness without a collation index. */
        shortNameKey: { type: String, required: true, trim: true, lowercase: true, unique: true },
        /**
         * How many decimals a quantity in this unit may carry.
         * 0 for counted goods, 2 or 3 for weight and volume.
         */
        decimalPlaces: { type: Number, default: 0, min: 0, max: 4 },
        /**
         * The unit this one converts into. Unset = this IS a base unit.
         * Referencing another unit that itself has a base is rejected in the
         * service, keeping every conversion a single multiply.
         */
        baseUnitId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUnit',
            index: true,
            default: undefined
        },
        /** How many base units one of this unit is worth. Meaningless without baseUnitId. */
        conversionFactor: { type: Number, default: null, min: 0 },
        isActive: { type: Boolean, default: true, index: true },
        sortOrder: { type: Number, default: 0 }
    },
    { collection: 'food_units', timestamps: true }
);

foodUnitSchema.index({ baseUnitId: 1, isActive: 1 });

export const FoodUnit = mongoose.model('FoodUnit', foodUnitSchema);
