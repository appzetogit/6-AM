import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUserFavorite } from '../models/userFavorite.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodItem } from '../../admin/models/food.model.js';

const toObjectId = (value, label) => {
    const raw = String(value || '').trim();
    if (!mongoose.Types.ObjectId.isValid(raw)) {
        throw new ValidationError(`Invalid ${label}`);
    }
    return new mongoose.Types.ObjectId(raw);
};

/**
 * Everything this user has favourited.
 *
 * Returns the ids AND the populated entities in one call. The ids are what every
 * heart icon binds to, so they must be present even when the underlying restaurant
 * or dish has since been deleted or unapproved — otherwise a heart would silently
 * un-fill and the user would think their tap was lost. The populated lists are what
 * the Favourites screen renders, and those legitimately omit anything no longer
 * orderable.
 */
export const getUserFavorites = async (userId) => {
    const owner = toObjectId(userId, 'user id');

    const rows = await FoodUserFavorite.find({ userId: owner })
        .select('entityType entityId')
        .sort({ createdAt: -1 })
        .lean();

    // Deduped on the way out: the unique index is the only thing stopping a
    // duplicate row, and it is absent for the first moments after a deployment.
    // A product listed twice on the wishlist screen is the kind of thing a
    // customer reports, and the cause would be long gone by then.
    const idsOf = (type) => [
        ...new Set(rows.filter((r) => r.entityType === type).map((r) => String(r.entityId)))
    ];
    const restaurantIds = idsOf('restaurant');
    const foodIds = idsOf('food');

    const [restaurants, foods] = await Promise.all([
        restaurantIds.length
            ? FoodRestaurant.find({
                  _id: { $in: restaurantIds },
                  status: 'approved'
              })
                  .select(
                      'restaurantName profileImage coverImage coverImages cuisines rating totalRatings area city location offer estimatedDeliveryTimeMinutes isAcceptingOrders'
                  )
                  .lean()
            : [],
        foodIds.length
            ? FoodItem.find({
                  _id: { $in: foodIds },
                  approvalStatus: 'approved'
              })
                  .select(
                      'name description price otherPrice image images foodType restaurantId rating totalRatings isAvailable variants'
                  )
                  .lean()
            : []
    ]);

    // Preserve the newest-first order the ids came back in; $in does not guarantee it.
    const byId = (list) => new Map(list.map((d) => [String(d._id), d]));
    const restaurantMap = byId(restaurants);
    const foodMap = byId(foods);

    // A wishlisted product is shown with the shop it comes from, and tapping it
    // goes there — so the name travels with the row rather than leaving every
    // client to look up shops it did not ask for. Shops already fetched for the
    // restaurant favourites are reused; only the rest are read.
    const missingShopIds = [
        ...new Set(
            foods
                .map((f) => String(f.restaurantId || ''))
                .filter((id) => id && !restaurantMap.has(id))
        )
    ];
    const extraShops = missingShopIds.length
        ? await FoodRestaurant.find({ _id: { $in: missingShopIds } }).select('restaurantName').lean()
        : [];
    const shopNameOf = new Map([
        ...restaurants.map((r) => [String(r._id), r.restaurantName]),
        ...extraShops.map((r) => [String(r._id), r.restaurantName])
    ]);

    return {
        restaurantIds,
        foodIds,
        restaurants: restaurantIds.map((id) => restaurantMap.get(id)).filter(Boolean),
        foods: foodIds
            .map((id) => foodMap.get(id))
            .filter(Boolean)
            .map((food) => ({
                ...food,
                restaurantName: shopNameOf.get(String(food.restaurantId)) || ''
            }))
    };
};

/**
 * Adds a favourite, or succeeds silently if it is already there.
 *
 * Idempotent on purpose: a double-tapped heart sends two adds, and a phone on a
 * bad connection retries the one it never saw answered. Treating a repeat as
 * success keeps the client's optimistic state correct without needing a debounce.
 *
 * An upsert rather than an insert, because the row must be unique whether or not
 * the unique index happens to exist yet. Mongoose builds indexes in the
 * background after the model is first used, so there is a window at startup in
 * which an insert-and-catch-11000 has nothing to collide with — two concurrent
 * taps in that window both landed, and un-hearting once then left the item still
 * favourited. The index stays as the backstop; this is the part that does not
 * depend on it.
 */
const addFavorite = async (userId, entityType, entityId) => {
    const owner = toObjectId(userId, 'user id');
    const target = toObjectId(entityId, `${entityType} id`);

    try {
        await FoodUserFavorite.updateOne(
            { userId: owner, entityType, entityId: target },
            { $setOnInsert: { userId: owner, entityType, entityId: target } },
            { upsert: true }
        );
    } catch (err) {
        // Two upserts racing on the same missing row can still both try to
        // insert; the loser's 11000 means the row is there, which is the
        // outcome asked for.
        if (err?.code !== 11000) throw err;
    }
    return { favorited: true, entityType, entityId: String(target) };
};

/**
 * Removing something that was never favourited is also success — same reasoning.
 *
 * deleteMany, not deleteOne. Uniqueness can only be enforced by the index, and
 * the index is not there for the first moments after a deployment — so a
 * duplicate row is possible, and with deleteOne a single un-heart would clear
 * one of two and leave the product still on the wishlist, with no way for the
 * customer to get it off but to tap again. One tap, gone, however many rows
 * happen to be under it.
 */
const removeFavorite = async (userId, entityType, entityId) => {
    const owner = toObjectId(userId, 'user id');
    const target = toObjectId(entityId, `${entityType} id`);

    await FoodUserFavorite.deleteMany({ userId: owner, entityType, entityId: target });
    return { favorited: false, entityType, entityId: String(target) };
};

export const addFavoriteRestaurant = (userId, restaurantId) =>
    addFavorite(userId, 'restaurant', restaurantId);

export const removeFavoriteRestaurant = (userId, restaurantId) =>
    removeFavorite(userId, 'restaurant', restaurantId);

export const addFavoriteFood = (userId, foodId) => addFavorite(userId, 'food', foodId);

export const removeFavoriteFood = (userId, foodId) =>
    removeFavorite(userId, 'food', foodId);
