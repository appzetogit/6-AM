/**
 * Smoke test against a running server.
 *
 *   npm run test:smoke                 # expects http://127.0.0.1:5000
 *   SMOKE_BASE_URL=... npm run test:smoke
 *
 * Answers one question the unit and integration tests cannot: does the whole
 * thing actually boot and serve? It calls no service directly — only HTTP — so
 * a broken route table, a missing middleware or a bad import shows up here even
 * though every service passes its own tests.
 *
 * Read-only apart from one OTP login, which is why it needs USE_DEFAULT_OTP.
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const API = `${BASE}/api/v1`;
const BOOT_TIMEOUT_MS = Number(process.env.SMOKE_BOOT_TIMEOUT_MS || 90_000);

let passed = 0;
const failures = [];

const check = async (name, fn) => {
    try {
        await fn();
        passed += 1;
        console.log(`  ok    ${name}`);
    } catch (err) {
        failures.push({ name, message: err?.message || String(err) });
        console.log(`  FAIL  ${name}\n          ${err?.message || err}`);
    }
};

const assert = (cond, message) => {
    if (!cond) throw new Error(message);
};

const get = async (path, headers = {}) => {
    const res = await fetch(`${API}${path}`, { headers });
    let body = null;
    try { body = await res.json(); } catch { /* not every error body is JSON */ }
    return { status: res.status, body };
};

const post = async (path, payload, headers = {}) => {
    const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload ?? {})
    });
    let body = null;
    try { body = await res.json(); } catch { /* ditto */ }
    return { status: res.status, body };
};

/** Polls /health until the server answers or the budget runs out. */
async function waitForBoot() {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let lastErr = 'no attempt made';
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${BASE}/health`);
            if (res.ok) return await res.json();
            lastErr = `HTTP ${res.status}`;
        } catch (err) {
            lastErr = err?.message || String(err);
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`server did not become healthy within ${BOOT_TIMEOUT_MS}ms (last: ${lastErr})`);
}

async function main() {
    console.log(`\nSmoke test → ${BASE}\n`);

    const health = await waitForBoot();
    console.log(`  ok    server is up (mongo=${health.mongo}, redis=${health.redis})\n`);
    passed += 1;

    await check('GET /api/v1/health returns UP', async () => {
        const { status, body } = await get('/health');
        assert(status === 200, `expected 200, got ${status}`);
        assert(body?.status === 'UP', `expected status UP, got ${body?.status}`);
    });

    await check('public business settings are reachable without a token', async () => {
        const { status, body } = await get('/food/admin/business-settings/public');
        assert(status === 200, `expected 200, got ${status}`);
        assert(body?.success === true, 'expected success:true');
    });

    await check('public product listing responds', async () => {
        const { status } = await get('/food/restaurant/public/foods?limit=1');
        assert(status === 200, `expected 200, got ${status}`);
    });

    await check('a protected route refuses an anonymous caller', async () => {
        const { status } = await get('/food/admin/foods');
        assert(status === 401, `expected 401, got ${status}`);
    });

    await check('the deploy webhook is not mounted unless configured', async () => {
        const res = await fetch(`${BASE}/api/deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        });
        assert(
            res.status === 404 || res.status === 403,
            `expected 404 (unmounted) or 403 (mounted, bad signature), got ${res.status}`
        );
    });

    // One real login, so the smoke test covers the auth path end to end rather
    // than only the doors that are meant to be shut.
    let userToken = null;
    await check('OTP login issues a usable token', async () => {
        const phone = `9${String(Date.now()).slice(-9)}`;
        const otpRes = await post('/food/auth/user/request-otp', { phone });
        assert(otpRes.status === 200, `request-otp: expected 200, got ${otpRes.status}`);
        const otp = otpRes.body?.data?.otp;
        assert(otp, 'no OTP in the response — smoke needs USE_DEFAULT_OTP=true');

        const verify = await post('/food/auth/user/verify-otp', { phone, otp, name: 'Smoke Test' });
        assert(verify.status === 200, `verify-otp: expected 200, got ${verify.status}`);
        userToken = verify.body?.data?.accessToken;
        assert(userToken, 'no access token returned');
    });

    await check('the token opens a user route', async () => {
        assert(userToken, 'skipped: login did not produce a token');
        const { status } = await get('/food/payments/wallet/balance', { Authorization: `Bearer ${userToken}` });
        assert(status === 200, `expected 200, got ${status}`);
    });

    // The authorization hole this endpoint used to have: a customer token could
    // read platform finances. Kept as a smoke check so a future refactor cannot
    // quietly reopen it.
    await check('a customer token is refused on the admin finance route', async () => {
        assert(userToken, 'skipped: login did not produce a token');
        const { status } = await get('/food/payments/admin/wallet', { Authorization: `Bearer ${userToken}` });
        assert(status === 403, `expected 403, got ${status}`);
    });

    console.log(`\n${passed} passed, ${failures.length} failed\n`);
    if (failures.length) {
        failures.forEach((f) => console.error(`  ✗ ${f.name}: ${f.message}`));
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(`\nSmoke test could not run: ${err?.message || err}\n`);
    process.exit(1);
});
