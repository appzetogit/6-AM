/**
 * Self-check for formatDeliveryAddress().
 * Run: node src/modules/food/shared/address.selfcheck.mjs
 */
import assert from 'node:assert/strict';
import { formatDeliveryAddress } from './geo.utils.js';

// Full address: flat/block are prefixed and lead, colony follows street.
assert.equal(
    formatDeliveryAddress({
        flatNumber: '302',
        blockNumber: 'B',
        street: 'MG Road',
        colonyName: 'Sunrise Colony',
        additionalDetails: 'Near temple',
        city: 'Indore',
        state: 'MP',
        zipCode: '452001',
    }),
    'Flat 302, Block B, MG Road, Sunrise Colony, Near temple, Indore, MP, 452001',
);

// Legacy address with none of the new fields must render exactly as before.
assert.equal(
    formatDeliveryAddress({ street: 'MG Road', city: 'Indore', state: 'MP', zipCode: '452001' }),
    'MG Road, Indore, MP, 452001',
);

// Blank and whitespace-only parts are dropped, not rendered as empty commas.
assert.equal(
    formatDeliveryAddress({ flatNumber: '  ', blockNumber: '', street: 'MG Road', city: 'Indore' }),
    'MG Road, Indore',
);

// Missing/garbage input never throws — this feeds push notifications.
assert.equal(formatDeliveryAddress(null), '');
assert.equal(formatDeliveryAddress(undefined), '');
assert.equal(formatDeliveryAddress('MG Road'), '');
assert.equal(formatDeliveryAddress({}), '');

// Numeric flat/block (clients send these unquoted) must still render.
assert.equal(
    formatDeliveryAddress({ flatNumber: 302, blockNumber: 7, street: 'MG Road' }),
    'Flat 302, Block 7, MG Road',
);

console.log('address.selfcheck: OK');
