# Implementation Plan — Anil Dogne call (2026-08-21)

Grounded in the actual repo. Ordered by dependency + risk. Nothing here needs a new
dependency; scheduling reuses BullMQ repeatables, geo reuses existing 2dsphere indexes.

## 0. Naming collision — read first

`subscription` in this codebase already means **restaurant → platform SaaS billing**
(`Backend/src/modules/food/restaurant/controllers/subscription.controller.js`,
`subscriptionInvoice.model.js`, monthly cron at `queues/workers/maintenance.worker.js:51`).

The customer "milk subscription" is a different thing. Call it **StandingOrder**
everywhere (`FoodStandingOrder`, `/standing-orders`). Do not overload `subscription`.

## Phase 1 — Address fields (½ day, ships alone)

**Ask:** flat number, block number, colony name.

- `Backend/src/core/users/user.model.js:3` — add to `userAddressSchema`:
  `flatNumber`, `blockNumber`, `colonyName` (String, default `''`, trim). Optional, not required.
- `Backend/src/modules/food/orders/models/order.model.js:64` — same 3 fields on
  `deliveryAddressSchema` (the order snapshots the address, so both must carry it).
- Validator in `src/validators/` + address form in `Frontend/src/modules/Food` and the
  drop-address card in `Frontend/src/modules/DeliveryV2`.

No migration: Mongo, all fields optional, old docs read as `''`.

**Improvement worth doing now:** keep `additionalDetails` as the free-text landmark line and
render the display address through ONE formatter helper —
`Flat {flat}, Block {block}, {street}, {colony}` with empty parts dropped — used by user app,
delivery app and POS receipt. Otherwise every screen re-implements it slightly differently.

## Phase 2 — Monthly offers (1 day — mostly already built)

`FoodOffer` (`admin/models/offer.model.js`) already has `minOrderValue`, `startDate`/`endDate`,
`createdByRole: 'RESTAURANT'`, `restaurantIds`. "Seller offer on orders above ₹3,000" is
**existing functionality** — it just needs surfacing in the seller offer form.

New work is only the pre-announcement:

- Add `announceAt` (Date) + `announcedAt` (Date) to the offer schema.
- Daily repeatable job in `maintenance.worker.js` (next to the existing 4am one): find offers
  where `announceAt <= now && !announcedAt && status === 'active'`, push to
  `notification.queue`, stamp `announcedAt`. Idempotent, so a missed day self-heals.

> The notes say "23 days in advance". That reads like a transcription of **2–3 days**.
> Making it a per-offer `announceAt` date sidesteps the question — the seller picks it.

## Phase 3 — Monthly list (1 day)

A saved cart, not a new order type.

- New model `FoodSavedList { userId, name, restaurantId, items[{ foodId, qty, addons }] }`.
- Endpoints under `/v1/food/user/lists`: CRUD + `POST /:id/to-cart`.
- `to-cart` must re-price and re-check stock through the existing
  `orders/services/order-pricing.service.js` + `inventory.service.js` — never trust stored
  prices. Return a diff ("2 items unavailable, 1 price changed") instead of failing outright.

## Phase 4 — Standing orders / milk subscription (3–4 days, the real work)

Model `FoodStandingOrder`:

```
userId, restaurantId, items[], deliveryAddress (snapshot),
schedule: { type: 'daily'|'weekly'|'custom', daysOfWeek[], slot: '06:00-08:00' },
startDate, endDate, status: 'active'|'paused'|'cancelled',
paymentMethod, skipDates: [Date], lastGeneratedFor: Date
```

Generation: a daily repeatable job at a fixed hour (e.g. 20:00) creates **tomorrow's** orders
through the existing `order.service.js` create path — so pricing, commission, inventory and
notifications all stay on one code path. Guard with `lastGeneratedFor` so a re-run cannot
double-create.

Cancel window "night before": the generated order sits in normal `orderStatus: 'created'`, so
user cancellation is the existing cancel flow (`cancelled_by_user`), hard-cut at the generation
hour. No bespoke cancellation model needed.

**Improvement:** ship `pause(from, to)` (vacation hold) on day one. It is one field and it is
the number-one support ticket for any milk subscription.

## Phase 5 — Manual assignment + 3-minute confirm (3–4 days, highest risk)

Current state: `orders/services/order-dispatch.service.js:340` **hard-codes
`dispatchMode: "auto"`** and `updateDispatchSettings` ignores its argument. The auto-assign path
(`tryAutoAssign`, line 359) and timeout path (`processDispatchTimeout`, line 638) are live.

Do **not** delete auto-assign — make the mode real:

- `getDispatchSettings` reads a persisted value (businessSettings) instead of a literal; allow
  `'auto' | 'manual'` with a per-restaurant override.
- Manual mode: on restaurant confirm, skip `tryAutoAssign`, leave `dispatch.status:
  'unassigned'`, emit a socket event to the seller dashboard.
- New endpoint `POST /v1/food/restaurant/orders/:orderId/assign-partner` (alongside
  `restaurant.routes.js:295-298`) → sets `dispatch.deliveryPartnerId`, `assignedAt`,
  `status: 'assigned'`, appends to the existing offer-history array (`order.model.js:170`) and
  fires the same partner notification auto-assign fires.
- Partner-picker payload: online partners in zone + **active order count** per partner (one
  `$group` on `dispatch.deliveryPartnerId` filtered to in-flight `orderStatus`). That count is
  the entire "avoid overloading one person" requirement — display it, don't automate it.

**3-minute confirm SLA:** enqueue a delayed job on `order.queue` at order creation
(`delay: 180_000`). On fire, if the order is still `created`: escalate (loud push + dashboard
alarm) and set `slaBreached`. Do **not** auto-cancel — auto-cancelling a paid order three
minutes in is a refund incident. Report the breach; let admin decide.

## Phase 6 — Delivery boy online only inside zone (1 day)

`delivery.service.js:413` sets `availabilityStatus` with no geo check.

- Require `lat`/`lng` on the go-online call (already accepted at that line).
- Resolve the partner's assigned zone and test containment. Zone polygons are stored as
  `{ latitude, longitude }` objects (`admin/models/zone.model.js`), **not** GeoJSON — so either
  add a GeoJSON mirror field with a 2dsphere index and use `$geoIntersects`, or ray-cast in JS.
  Add the mirror field; `$geoIntersects` is wanted for zone-based routing anyway.
- Reject with a clear reason. Also re-check on the periodic location ping and auto-offline on
  exit — otherwise a partner goes online at the boundary and drives away.

## Phase 7 — POS (2 days)

Seller-side manual entry for walk-in customers.

- One endpoint `POST /v1/food/restaurant/orders/pos` reusing the `order.service.js` create path,
  with `source: 'pos'` and `payment.method: 'cash'`.
- No delivery partner, no delivery fee; goes straight to `delivered`.
- Identify the customer by phone and create-or-link the user, so POS purchases count toward
  loyalty and the monthly-offer threshold. **That is the point of POS** — skip it and it is
  just a receipt printer.

## Phase 8 — Survey popup (1–1.5 days)

- `FoodSurvey { title, questions[{ text, type, options[] }], audience, isActive }`, admin-authored.
- `FoodSurveyResponse { surveyId, userId, answers[] }` with a unique index on
  `(surveyId, userId)` — that index *is* the "show only once" rule. No flag on the user doc.
- User app fetches the active survey on launch and skips it if a response exists; store a
  dismissal as a response with `dismissed: true`.

## Suggested sequencing

| Sprint | Contents | Why |
|---|---|---|
| 1 | Phases 1, 2, 8 | Independent, low risk, visible immediately |
| 2 | Phases 5, 6 | Same dispatch surface — together, or you touch it twice |
| 3 | Phases 3, 4 | Lists feed standing orders; needs Sprint 1 addresses |
| 4 | Phase 7 | Cleanest last; benefits from a stable order-create path |

## Confirm with Anil before Sprint 2

1. "23 days in advance" — is that 2–3 days? (Phase 2 dodges it, but confirm intent.)
2. Manual assignment: global, or per-seller toggle? (Plan assumes per-seller override.)
3. Unconfirmed after 3 min — escalate or auto-cancel? (Plan says escalate.)
4. Standing-order payment: charged per delivery, or invoiced monthly?
