import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test database connection.
 *
 * Always a *different* database from the one the app runs on: the URI's path is
 * replaced with MONGO_TEST_DB. These tests truncate collections between cases,
 * so pointing them at a development database would delete real work, and the
 * mistake is the kind that is only noticed afterwards.
 */
const TEST_DB = process.env.MONGO_TEST_DB || 'switcheats_test';

const testUri = () => {
    if (process.env.MONGO_TEST_URI) return process.env.MONGO_TEST_URI;
    const base = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
    const [beforeQuery, query] = base.split('?');
    const withoutDb = beforeQuery.replace(/\/[^/]*$/, '');
    return `${withoutDb}/${TEST_DB}${query ? `?${query}` : ''}`;
};

export async function connectTestDb() {
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    const uri = testUri();
    const name = uri.split('?')[0].split('/').pop();
    if (!name || !/test/i.test(name)) {
        throw new Error(`Refusing to run tests against database "${name}" — its name must contain "test"`);
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
    return mongoose.connection;
}

/** Empties every collection, so each test starts from a known state. */
export async function resetDb() {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function disconnectTestDb() {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

/** A throwaway ObjectId, for foreign keys the test does not care about. */
export const someId = () => new mongoose.Types.ObjectId();

/**
 * Asserts that `fn` rejects, and that the message contains `needle`.
 *
 * Written by hand rather than with assert.rejects because the guards under test
 * are user-facing messages — matching on the text is the point.
 */
export async function expectError(fn, needle, assert) {
    let threw = null;
    try {
        await fn();
    } catch (err) {
        threw = err;
    }
    assert.ok(threw, `expected an error containing "${needle}", but none was thrown`);
    assert.ok(
        String(threw.message).toLowerCase().includes(String(needle).toLowerCase()),
        `expected error "${threw.message}" to contain "${needle}"`
    );
    return threw;
}
