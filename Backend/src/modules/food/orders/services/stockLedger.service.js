import { FoodStockMovement } from '../models/stockMovement.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Appends one row to the stock movement ledger.
 *
 * Never throws. The ledger explains stock; it must not be able to block it. A
 * sale that reserved its units correctly is still a good sale if the history
 * row failed to write, so a failure here is logged loudly and swallowed.
 *
 * `itemName`/`itemCode`/`restaurantId` can be passed to save a lookup when the
 * caller already has the item; otherwise they are read from the item.
 */
export async function recordMovement({
    itemId,
    type,
    qtyChange,
    qtyBefore = null,
    qtyAfter = null,
    reason = '',
    note = '',
    reference = null,
    createdBy = null,
    item = null
}) {
    try {
        const doc = item || (await FoodItem.findById(itemId).select('name itemCode restaurantId').lean());
        if (!doc) return null;
        return await FoodStockMovement.create({
            itemId,
            restaurantId: doc.restaurantId,
            itemName: doc.name || '',
            itemCode: doc.itemCode || '',
            type,
            qtyChange: Number(qtyChange) || 0,
            qtyBefore,
            qtyAfter,
            reason,
            note,
            reference: reference || { kind: 'system', id: null, label: '' },
            createdBy: createdBy || { role: 'SYSTEM', id: null, name: '' }
        });
    } catch (err) {
        logger.error(
            `[stock-ledger] failed to record ${type} ${qtyChange} for item ${itemId}: ${err?.message || err}`
        );
        return null;
    }
}
