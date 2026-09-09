# CI / CD

Two workflows. `ci.yml` runs on every push and PR; `deploy.yml` runs only after
CI goes green on `master`, or on a manual confirm.

## CI

| Job | What it does | Blocking |
|---|---|---|
| **guard** | scans every file that executes on install or build, before anything installs or builds | yes — `backend` and `frontend` both `needs: guard` |
| **backend** | `npm run test:unit` (7 selfchecks, no DB) → `npm run test:integration` (36 tests against a real Mongo service) → boots the server and runs `npm run test:smoke` against it | yes |
| **frontend** | `npm run lint` → `npm run build` → uploads `dist` as an artifact | build yes, lint advisory |
| **audit** | `npm audit --audit-level=high` on both apps | no (`continue-on-error`) |

`audit` is the one job that does not wait for `guard`: `npm audit` reads the
lockfile and runs no project code, so there is nothing for a tampered config to
execute there.

### Why there is a build-config guard

`origin/master` has twice been force-pushed with obfuscated malware appended to
`Frontend/vite.config.js` — 2026-08-26 and again 2026-09-09. Vite loads that
file, so the payload ran on every `npm run dev` and on every CI runner that
built the frontend, with that job's secrets in reach.

`.github/scripts/scan-build-config.mjs` checks `*.config.*` files and
`package.json` install hooks against three independent rules:

1. **Known indicators** — strings from the two incidents. Exact and free, but
   worth little alone: one edited byte defeats it.
2. **Absurdly long lines** — over 500 characters. Appended payloads are
   minified onto one line; the 2026-09-09 one was 7,596 characters, padded with
   tabs so it sat off the right edge of an editor. Hand-written config is narrow.
3. **Constructs that do not belong in a config file** — `eval`, `new Function`,
   `child_process`, raw `node:http`/`node:net` clients, `atob`. A config
   declares options; it does not spawn processes or open sockets.

Rules 2 and 3 both fire on the real payload with every known indicator removed,
which is the point — the guard has to survive the attacker reading it.

Rule 3 is the one that can misfire; a config that shells out to `git` for a
build stamp is legitimate. `ALLOW` in the script exists for that, keyed
`path::rule`. It is empty today, and an entry belongs in review, not in a rush.

The scanner self-checks first (`--selftest`, seven cases). A detector that has
silently stopped detecting is worse than none, because it reads as a green tick.

`deploy.yml` runs the scan again after checkout. A `workflow_dispatch` deploy
skips CI entirely, and hand-deploying a tampered commit is exactly the route
someone would take once CI began refusing it.

### Why the integration tests use a real database

They cover the conditional decrement, the partial rollback and the restock
claim — all of which are Mongo behaviour. A mock would only assert that the mock
behaves like the mock, which is exactly the bug class these tests exist to catch.
The job runs `mongo:7` and `redis:7` as service containers.

The test helper refuses to run against a database whose name does not contain
`test`, because it truncates collections between cases.

### Why lint is advisory

`npm run lint` was in `package.json` but there was no eslint config, so it had
never run. Switching it on surfaced a backlog already in the tree:

| Rule | Count | Notes |
|---|---|---|
| `react-hooks/rules-of-hooks` | 89 (3 files) | conditional hook calls — genuinely breaks React |
| `no-case-declarations` | 20 (2 files) | `let`/`const` in a `switch` case without a block |
| `no-useless-escape` | 18 (7 files) | |
| `no-undef` | 15 (13 files) | undefined identifiers — a `ReferenceError` when reached |
| `no-unreachable` | 7 (2 files) | dead code after `return` |
| `no-dupe-keys` | 6 (1 file) | duplicate keys in `services/api/index.js`; the later one silently wins |
| other | 6 | |

Failing CI on these would block every unrelated change behind a cleanup nobody
has scheduled, so the historical count is reported rather than enforced. Errors
in files a PR actually touches **are** blocking — see the "Lint changed files"
step. When the backlog reaches zero, drop `continue-on-error` from the advisory
step and it can never come back.

The ~1955 warnings are almost all `eslint-plugin-react-hooks` v7's new rules
(`set-state-in-effect`, `immutability`, `purity`, …). They describe real smells
but are new opinions applied retroactively; promote one to `error` in
`Frontend/eslint.config.js` as its count reaches zero.

## Deploy

Calls the deploy webhook in `Backend/src/routes/deploy.routes.js`, signing an
HMAC over the exact request bytes the way that route verifies it.

Required on the `production` environment:

| Secret | Purpose |
|---|---|
| `DEPLOY_WEBHOOK_URL` | e.g. `https://6amfresh.in/api/deploy` |
| `DEPLOY_WEBHOOK_SECRET` | must match the server's `DEPLOY_WEBHOOK_SECRET` |
| `DEPLOY_HEALTH_URL` | optional; polled after deploy, e.g. `https://6amfresh.in/health` |

The server also needs these in its `.env`, or the endpoint is not mounted at all
and returns 404:

```
DEPLOY_WEBHOOK_ENABLED=true
DEPLOY_WEBHOOK_SECRET=<32+ chars, same as the GitHub secret>
DEPLOY_SCRIPT_PATH=/absolute/path/to/deploy.sh
```

Response handling is explicit: `202` accepted, `409` a deploy was already
running (warning, not a failure), `403` signature mismatch, `404` endpoint not
mounted. The webhook returns immediately and runs the script in the background,
so the workflow then polls `/health` until the app serves again — "accepted" is
not "finished".

`concurrency` allows one deploy at a time and never cancels one midway: the
script on the far side is not resumable.

## Running the same checks locally

From the repository root — worth running after any `git pull` that touches a
config file, since the payload is designed to be invisible in a diff view:

```bash
node .github/scripts/scan-build-config.mjs
node .github/scripts/scan-build-config.mjs --selftest
```

```bash
cd Backend
npm run test:unit          # no database needed
npm run test:integration   # needs Mongo; writes to a *_test database
npm test                   # both
npm start & npm run test:smoke
```

```bash
cd Frontend
npm run lint
npm run build
```
