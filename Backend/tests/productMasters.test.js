import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { connectTestDb, disconnectTestDb, expectError, resetDb, someId } from './helpers/db.js';
import * as masters from '../src/modules/food/admin/services/productMasters.service.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';

/**
 * Brands, units and departments — the lookup tables behind the product form.
 *
 * The rules worth testing are the ones a user can hit by accident: a duplicate
 * name typed in a different case, a two-level unit conversion, and the delete
 * guards that stop a record disappearing from under something that points at it.
 */

before(connectTestDb);
after(disconnectTestDb);
beforeEach(resetDb);

describe('brands', () => {
    it('creates a brand and rejects a duplicate name regardless of case', async () => {
        await masters.createBrand({ name: 'Amul' });
        await expectError(() => masters.createBrand({ name: 'aMuL' }), 'already exists', assert);
    });

    it('nests a sub-brand and reports its parent in the list', async () => {
        const parent = await masters.createBrand({ name: 'Amul' });
        await masters.createBrand({ name: 'Amul Gold', parentId: parent._id });

        const { brands, total } = await masters.listBrands({});
        assert.equal(total, 2);
        const child = brands.find((b) => b.name === 'Amul Gold');
        assert.equal(child.parentName, 'Amul');
    });

    it('allows only one level of nesting', async () => {
        const parent = await masters.createBrand({ name: 'Amul' });
        const child = await masters.createBrand({ name: 'Amul Gold', parentId: parent._id });
        await expectError(
            () => masters.createBrand({ name: 'Deep', parentId: child._id }),
            'cannot be the parent',
            assert
        );
    });

    it('refuses to delete a brand that still has sub-brands', async () => {
        const parent = await masters.createBrand({ name: 'Amul' });
        await masters.createBrand({ name: 'Amul Gold', parentId: parent._id });
        await expectError(() => masters.deleteBrand(parent._id), 'sub-brand', assert);
    });

    it('refuses to delete a brand still used by a product', async () => {
        const brand = await masters.createBrand({ name: 'Amul' });
        await FoodItem.create({ restaurantId: someId(), name: 'Milk', price: 50, brand: 'Amul' });
        await expectError(() => masters.deleteBrand(brand._id), 'product(s) use this brand', assert);
    });

    it('deletes a brand nothing points at', async () => {
        const brand = await masters.createBrand({ name: 'Solo' });
        await masters.deleteBrand(brand._id);
        const { total } = await masters.listBrands({});
        assert.equal(total, 0);
    });
});

describe('units of measurement', () => {
    it('stores a conversion and renders it as a label', async () => {
        const piece = await masters.createUnit({ name: 'Piece', shortName: 'pc', decimalPlaces: 0 });
        await masters.createUnit({ name: 'Box', shortName: 'box', baseUnitId: piece._id, conversionFactor: 12 });

        const { units } = await masters.listUnits({});
        const box = units.find((u) => u.name === 'Box');
        assert.equal(box.conversionLabel, '1 box = 12 pc');
        assert.equal(units.find((u) => u.name === 'Piece').conversionLabel, '');
    });

    it('requires a conversion factor whenever a base unit is set', async () => {
        const piece = await masters.createUnit({ name: 'Piece', shortName: 'pc' });
        await expectError(
            () => masters.createUnit({ name: 'Box', shortName: 'box', baseUnitId: piece._id }),
            'conversionFactor must be greater than 0',
            assert
        );
    });

    it('keeps conversions one level deep', async () => {
        const piece = await masters.createUnit({ name: 'Piece', shortName: 'pc' });
        const box = await masters.createUnit({ name: 'Box', shortName: 'box', baseUnitId: piece._id, conversionFactor: 12 });
        await expectError(
            () => masters.createUnit({ name: 'Case', shortName: 'cs', baseUnitId: box._id, conversionFactor: 4 }),
            'one level deep',
            assert
        );
    });

    it('rejects a decimal-place count outside 0–4', async () => {
        await expectError(
            () => masters.createUnit({ name: 'Bad', shortName: 'bad', decimalPlaces: 9 }),
            'between 0 and 4',
            assert
        );
    });

    it('refuses to delete a base unit others convert into', async () => {
        const piece = await masters.createUnit({ name: 'Piece', shortName: 'pc' });
        await masters.createUnit({ name: 'Box', shortName: 'box', baseUnitId: piece._id, conversionFactor: 12 });
        await expectError(() => masters.deleteUnit(piece._id), 'convert into this one', assert);
    });
});

describe('departments', () => {
    it('records who created it and resolves the name on read', async () => {
        const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
        const admin = await FoodAdmin.create({ email: 'ops@test.dev', password: 'x', name: 'Ops Lead' });

        await masters.createDepartment({ name: 'Grocery', code: 'GRC' }, { userId: String(admin._id) });
        const { departments } = await masters.listDepartments({});
        assert.equal(departments[0].createdBy, 'Ops Lead');
        assert.equal(departments[0].code, 'GRC');
    });

    it('falls back to System when nobody is recorded', async () => {
        await masters.createDepartment({ name: 'Unowned' }, null);
        const { departments } = await masters.listDepartments({});
        assert.equal(departments[0].createdBy, 'System');
    });

    it('rejects a blank name and a duplicate name', async () => {
        await expectError(() => masters.createDepartment({ name: '   ' }, null), 'name is required', assert);
        await masters.createDepartment({ name: 'Grocery' }, null);
        await expectError(() => masters.createDepartment({ name: 'GROCERY' }, null), 'already exists', assert);
    });
});
