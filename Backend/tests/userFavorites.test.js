import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectTestDb, disconnectTestDb, expectError, resetDb, someId } from './helpers/db.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodUser } from '../src/core/users/user.model.js';
import { FoodUserFavorite } from '../src/modules/food/user/models/userFavorite.model.js';
import * as favorites from '../src/modules/food/user/services/userFavorite.service.js';

/**
 * The customer's wishlist.
 *
 * The behaviour worth pinning down is that a heart is idempotent in both
 * directions — a double tap must not create two rows, and un-hearting
 * something that was never hearted is not an error — because the client is
 * optimistic and a phone on a bad connection retries.
 */

before(connectTestDb);
after(disconnectTestDb);
beforeEach(resetDb);

/**
 * The double-tap test is run twice over: once with the unique index in place,
 * and once without it. resetDb only empties collections, so an index built by
 * an earlier run would hide the very gap this is checking — a fresh
 * deployment's first taps arrive before Mongoose has finished building it.
 */
const dropUniqueIndex = async () => {
    try {
        await FoodUserFavorite.collection.dropIndex('userId_1_entityType_1_entityId_1');
    } catch {
        // Already absent, which is the state the test wants.
    }
};

const makeUser = (over = {}) => FoodUser.create({ phone: '9800000001', name: 'Asha', ...over });

const makeShop = (over = {}) =>
    FoodRestaurant.create({
        restaurantName: 'Corner Store',
        ownerName: 'Owner',
        ownerPhone: '9000000001',
        phone: '9000000001',
        status: 'approved',
        ...over
    });

const makeProduct = (restaurantId, over = {}) =>
    FoodItem.create({ restaurantId, name: 'Amul Gold 1L', price: 68, approvalStatus: 'approved', ...over });

describe('adding to the wishlist', () => {
    it('saves a product against the customer', async () => {
        const user = await makeUser();
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);

        const result = await favorites.addFavoriteFood(user._id, milk._id);
        assert.deepEqual(result, { favorited: true, entityType: 'food', entityId: String(milk._id) });

        const rows = await FoodUserFavorite.find({ userId: user._id }).lean();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].entityType, 'food');
        assert.equal(String(rows[0].entityId), String(milk._id));
    });

    it('survives a double-tapped heart, with the unique index in place', async () => {
        await FoodUserFavorite.init();
        const user = await makeUser();
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);

        const [a, b] = await Promise.all([
            favorites.addFavoriteFood(user._id, milk._id),
            favorites.addFavoriteFood(user._id, milk._id)
        ]);
        assert.equal(a.favorited, true);
        assert.equal(b.favorited, true);
        assert.equal(await FoodUserFavorite.countDocuments({ userId: user._id }), 1, 'one row, not two');
    });

    it('survives a double-tapped heart before the index has been built', async () => {
        // The window after a deployment, when Mongoose has not finished
        // building the index. Nothing can stop two concurrent writes creating
        // two rows there — so what has to hold is the contract the customer
        // sees: the product appears once, and one un-heart takes it off.
        await dropUniqueIndex();
        const user = await makeUser();
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);

        await Promise.all([
            favorites.addFavoriteFood(user._id, milk._id),
            favorites.addFavoriteFood(user._id, milk._id)
        ]);
        const { foodIds, foods } = await favorites.getUserFavorites(user._id);
        assert.deepEqual(foodIds, [String(milk._id)], 'listed once, whatever is underneath');
        assert.equal(foods.length, 1);

        // And one un-heart clears it — with deleteOne this left the second row
        // behind and the product stayed on the wishlist.
        await favorites.removeFavoriteFood(user._id, milk._id);
        assert.deepEqual((await favorites.getUserFavorites(user._id)).foodIds, []);
        assert.equal(await FoodUserFavorite.countDocuments({}), 0);
    });

    it('keeps one customer\'s wishlist out of another\'s', async () => {
        const asha = await makeUser();
        const ravi = await makeUser({ phone: '9800000002', name: 'Ravi' });
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);

        await favorites.addFavoriteFood(asha._id, milk._id);
        assert.deepEqual((await favorites.getUserFavorites(ravi._id)).foodIds, []);
        assert.deepEqual((await favorites.getUserFavorites(asha._id)).foodIds, [String(milk._id)]);
    });

    it('takes a product from any shop, not just one', async () => {
        const user = await makeUser();
        const [a, b] = await Promise.all([
            makeShop(),
            makeShop({ restaurantName: 'Other', ownerPhone: '9000000002', phone: '9000000002' })
        ]);
        const milk = await makeProduct(a._id, { name: 'Milk' });
        const bread = await makeProduct(b._id, { name: 'Bread' });

        await favorites.addFavoriteFood(user._id, milk._id);
        await favorites.addFavoriteFood(user._id, bread._id);

        const { foods } = await favorites.getUserFavorites(user._id);
        assert.deepEqual(foods.map((f) => f.name).sort(), ['Bread', 'Milk']);
    });

    it('refuses an id that is not one', async () => {
        const user = await makeUser();
        await expectError(() => favorites.addFavoriteFood(user._id, 'not-an-id'), 'Invalid food id', assert);
        await expectError(() => favorites.addFavoriteFood('nobody', someId()), 'Invalid user id', assert);
    });
});

describe('removing from the wishlist', () => {
    it('removes it, and removing again is still fine', async () => {
        const user = await makeUser();
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);

        await favorites.addFavoriteFood(user._id, milk._id);
        const first = await favorites.removeFavoriteFood(user._id, milk._id);
        assert.equal(first.favorited, false);
        assert.equal(await FoodUserFavorite.countDocuments({}), 0);

        // A retry from a phone that lost the response must not be an error.
        const again = await favorites.removeFavoriteFood(user._id, milk._id);
        assert.equal(again.favorited, false);
    });

    it('leaves the rest of the wishlist alone', async () => {
        const user = await makeUser();
        const shop = await makeShop();
        const milk = await makeProduct(shop._id, { name: 'Milk' });
        const bread = await makeProduct(shop._id, { name: 'Bread' });

        await favorites.addFavoriteFood(user._id, milk._id);
        await favorites.addFavoriteFood(user._id, bread._id);
        await favorites.removeFavoriteFood(user._id, milk._id);

        const { foods } = await favorites.getUserFavorites(user._id);
        assert.deepEqual(foods.map((f) => f.name), ['Bread']);
    });
});

describe('reading the wishlist back', () => {
    it('lists newest first', async () => {
        const user = await makeUser();
        const shop = await makeShop();
        const first = await makeProduct(shop._id, { name: 'First' });
        const second = await makeProduct(shop._id, { name: 'Second' });

        await favorites.addFavoriteFood(user._id, first._id);
        await new Promise((r) => setTimeout(r, 20));
        await favorites.addFavoriteFood(user._id, second._id);

        const { foods } = await favorites.getUserFavorites(user._id);
        assert.deepEqual(foods.map((f) => f.name), ['Second', 'First'], 'most recently added at the top');
    });

    it('keeps the id but drops the card when a product stops being orderable', async () => {
        const user = await makeUser();
        const shop = await makeShop();
        const milk = await makeProduct(shop._id);
        await favorites.addFavoriteFood(user._id, milk._id);

        await FoodItem.updateOne({ _id: milk._id }, { $set: { approvalStatus: 'rejected' } });

        const { foodIds, foods } = await favorites.getUserFavorites(user._id);
        assert.deepEqual(foodIds, [String(milk._id)], 'the heart the customer tapped stays filled');
        assert.deepEqual(foods, [], 'but an unorderable product is not offered on the wishlist screen');
    });

    it('returns empty lists for someone who has wishlisted nothing', async () => {
        const user = await makeUser();
        const result = await favorites.getUserFavorites(user._id);
        assert.deepEqual(result, { restaurantIds: [], foodIds: [], restaurants: [], foods: [] });
    });

    it('carries the fields a wishlist card needs', async () => {
        const user = await makeUser();
        const shop = await makeShop();
        const milk = await makeProduct(shop._id, { price: 68, image: 'milk.jpg', foodType: 'Veg' });
        await favorites.addFavoriteFood(user._id, milk._id);

        const [food] = (await favorites.getUserFavorites(user._id)).foods;
        assert.equal(food.name, 'Amul Gold 1L');
        assert.equal(food.price, 68);
        assert.equal(food.image, 'milk.jpg');
        assert.equal(String(food.restaurantId), String(shop._id), 'so the card can link to the shop');
        assert.equal(food.restaurantName, 'Corner Store', 'and name it without a second round trip');
        assert.equal(food.isAvailable, true);
    });

    it('names the shop on a product even when that shop is not itself wishlisted', async () => {
        const user = await makeUser();
        const shop = await makeShop({ restaurantName: 'Dairy Corner' });
        const milk = await makeProduct(shop._id);
        await favorites.addFavoriteFood(user._id, milk._id);

        const { restaurants, foods } = await favorites.getUserFavorites(user._id);
        assert.deepEqual(restaurants, [], 'the shop itself was never hearted');
        assert.equal(foods[0].restaurantName, 'Dairy Corner');
    });
});
