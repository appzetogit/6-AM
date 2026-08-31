# New Features — API Spec (Monthly Lists, Monthly Offers, Subscriptions, POS, Survey, Delivery Fleet)

Companion to [FLUTTER_API_SPEC.md](FLUTTER_API_SPEC.md) (User app), [RESTAURANT_API_SPEC.md](RESTAURANT_API_SPEC.md), [DELIVERY_API_SPEC.md](DELIVERY_API_SPEC.md). Same global conventions apply (base URL `{HOST}/api/v1`, `Authorization: Bearer <accessToken>`, envelope `{ success, message, data }`). This doc covers everything **new** — build against it in addition to the existing specs.

All endpoints below were built and end-to-end tested against a live server + MongoDB in this work cycle (67 checks passed across three test runs).

---

## 1. Customer address fields (Flat / Block / Colony)

Already covered in [FLUTTER_API_SPEC.md §6](FLUTTER_API_SPEC.md) — `flatNumber`, `blockNumber`, `colonyName` are optional string fields on `POST/PATCH /food/user/addresses`. No separate work needed here; just make sure the address form includes these three inputs.

---

## 2. Monthly Lists — User app, `/food/user/monthly-lists` (Bearer, role USER)

A saved, reusable list of items from one restaurant. The customer builds it once and taps "place this month's order" whenever they want — **nothing is automatic here**, this is not a recurring subscription (see §4 for that).

| Method | Path | Purpose |
|---|---|---|
| POST | `/food/user/monthly-lists` | Create a list |
| GET | `/food/user/monthly-lists` | List all of the customer's lists |
| GET | `/food/user/monthly-lists/:listId` | Get one list |
| PATCH | `/food/user/monthly-lists/:listId` | Rename / edit items / activate-deactivate |
| DELETE | `/food/user/monthly-lists/:listId` | Delete |
| POST | `/food/user/monthly-lists/:listId/order` | Place an order from this list right now |

### `POST /food/user/monthly-lists`
```json
{
  "name": "My Monthly Groceries",        // optional, default "My Monthly List"
  "restaurantId": "…",
  "items": [
    { "itemId": "…", "variantId": "…", "quantity": 2 }   // variantId optional
  ]
}
```
All items must belong to `restaurantId` — a list is single-restaurant. → 201, `{ list }`.

### `PATCH /food/user/monthly-lists/:listId`
```json
{ "name": "…", "isActive": true, "items": [ … ] }   // all optional, at least one required
```

### `POST /food/user/monthly-lists/:listId/order`
```json
{
  "addressId": "…",              // one of these two is required
  "address": { … },               // raw address object, same shape as order creation
  "paymentMethod": "cash",        // cash | razorpay | card | wallet — default cash
  "deliveryMode": "basic",        // basic | quick — default basic
  "couponCode": "…"                // optional
}
```
→ 201, `{ order, payment }` — **identical shape to a normal order** (see FLUTTER_API_SPEC order section). Items are re-priced and re-validated fresh (stock, availability, coupons) every time — the list never uses a stale saved price. List's `lastOrderedAt` / `lastOrderId` update after a successful order.

---

## 3. Monthly Offers — Restaurant app creates, User app just sees them as normal offers

No new customer-facing endpoint — a monthly offer **is** a regular coupon (same `GET /food/offers`-style discovery your app already uses), just flagged internally so it auto-renews. Sellers configure it via the existing restaurant offers endpoint with two new optional fields:

### `POST /food/restaurant/my-offers` (Bearer, role RESTAURANT) — existing endpoint, new fields
```json
{
  "couponCode": "MONTHLY3K",
  "discountType": "flat-price",          // percentage | flat-price
  "discountValue": 100,
  "minOrderValue": 3000,
  "isMonthly": true,                     // NEW — makes it auto-renewing
  "notifyDaysBeforeNextMonth": 23        // NEW — optional, default 23
}
```
If `isMonthly: true` and no `startDate`/`endDate` given, the window auto-fills to "now through end of current calendar month." When the window ends, the backend automatically rolls it forward to the next full calendar month (reactivating it, resetting usage counts) — the seller never has to recreate it.

**Customer notification**: `notifyDaysBeforeNextMonth` days before next month starts, every customer who has previously ordered from that restaurant gets a push notification + an in-app notification (`source: "MONTHLY_OFFER"` in the existing notifications list — see notifications section of FLUTTER_API_SPEC.md) telling them the offer will be active again next month. This happens automatically server-side; nothing for the app to poll.

---

## 4. Product Subscriptions — User app, `/food/user/subscriptions` (Bearer, role USER)

Recurring auto-delivery of one specific product (e.g. milk), unlike Monthly Lists — the customer sets it up once and orders get placed **automatically** on schedule, no action needed each cycle.

| Method | Path | Purpose |
|---|---|---|
| POST | `/food/user/subscriptions` | Create a subscription |
| GET | `/food/user/subscriptions` | List subscriptions |
| GET | `/food/user/subscriptions/:subscriptionId` | Get one, **including its scheduled deliveries** |
| PATCH | `/food/user/subscriptions/:subscriptionId` | Pause / resume / cancel / edit quantity, time, address |
| DELETE | `/food/user/subscriptions/:subscriptionId` | Cancel entirely |
| GET | `/food/user/subscriptions/:subscriptionId/occurrences` | List every scheduled/cancelled/placed delivery |
| POST | `/food/user/subscriptions/:subscriptionId/occurrences/:occurrenceId/cancel` | Cancel **one specific** upcoming delivery |

### `POST /food/user/subscriptions`
```json
{
  "restaurantId": "…",
  "itemId": "…",                     // e.g. the "Milk 1L" product
  "variantId": "…",                  // optional
  "quantity": 2,
  "frequency": "daily",              // daily | weekly | monthly
  "daysOfWeek": [1, 3, 5],           // required if frequency = weekly (0=Sun..6=Sat)
  "dayOfMonth": 15,                  // required if frequency = monthly (1-28)
  "deliveryTime": "07:00",           // required, "HH:mm" 24h — the customer's chosen delivery time
  "startDate": "2026-09-01",         // required, cannot be in the past
  "addressId": "…",                  // one of the customer's saved addresses
  "paymentMethod": "cash"            // cash | razorpay | wallet — default cash
}
```
→ 201, `{ subscription }`. The next 14 days of deliveries are pre-generated immediately (visible via the `occurrences` endpoint / the `GET /:id` response).

### `GET /food/user/subscriptions/:subscriptionId` → `{ subscription, occurrences: [...] }`
Each occurrence:
```json
{
  "_id": "…", "scheduledDate": "2026-09-01T00:00:00.000Z", "deliveryTime": "07:00",
  "status": "scheduled",             // scheduled | cancelled | order_placed | failed
  "orderId": null,                   // set once the order is actually placed
  "cancelledAt": null, "cancelReason": ""
}
```

### `PATCH /food/user/subscriptions/:subscriptionId`
```json
{ "status": "paused", "quantity": 3, "deliveryTime": "08:00", "addressId": "…" }  // all optional
```
Setting `status` to `paused` or `cancelled` also cancels every still-`scheduled` future occurrence.

### `POST /food/user/subscriptions/:subscriptionId/occurrences/:occurrenceId/cancel`
```json
{ "reason": "Out of town" }   // optional
```
**Cutoff rule, exactly as specified**: cancellable any time up until midnight starting the scheduled delivery day — i.e. "the night before." Once the delivery day itself begins, this returns a 400 with:
```json
{ "success": false, "message": "Too late to cancel — this can only be cancelled the night before the scheduled delivery" }
```
Show this error to the customer verbatim, or replace it with your own copy — either way, **don't let the app allow cancel-day-of in the UI**, since the server will reject it anyway.

### How the actual delivery happens
On the scheduled date, the backend automatically places a real order (same order object/shape as any other order — same order-status lifecycle, same push notifications) using the subscription's saved item/quantity/address/payment method. The occurrence's `orderId` gets set once that happens — poll or refresh `GET /:subscriptionId` to pick up `order_placed` status and the resulting order.

---

## 5. POS Facility — Restaurant app, `/food/restaurant/pos/orders` (Bearer, role RESTAURANT)

For a seller entering an order on behalf of a walk-in customer at the physical store.

### `POST /food/restaurant/pos/orders`
```json
{
  "customerName": "Ramesh",              // used only if this phone has no account yet
  "customerPhone": "9876543210",
  "items": [{ "itemId": "…", "variantId": "…", "quantity": 2 }],
  "paymentMethod": "cash"                // default cash
}
```
→ 201, `{ order, payment }` — same shape as a normal order, with `order.source === "pos"` so it's distinguishable in reporting/analytics. A `FoodUser` account is auto-created/found by phone number if one doesn't already exist — the seller doesn't need the customer to have the app.

---

## 6. Survey Popup — User app, `/food/user/survey/active` (Bearer, role USER)

Shown when the app opens, only ever once, only to users who are "new" (their account was created after the currently-active survey was published).

### `GET /food/user/survey/active`
Call this once per app open (e.g. right after login/splash). → `{ survey }` where `survey` is either `null` (nothing to show) or:
```json
{
  "_id": "…", "title": "Welcome survey", "description": "…",
  "questions": [
    { "_id": "…", "text": "How did you hear about us?", "type": "text", "options": [] },
    { "_id": "…", "text": "How likely are you to recommend us?", "type": "rating", "options": [] }
  ]
}
```
`type` is one of `text | single-choice | multiple-choice | rating` — render accordingly (`options` is populated for choice types). **Important**: calling this endpoint marks the survey as shown, even if the user dismisses the popup without answering — a second call will return `survey: null`. So only call it when you're actually about to display the popup, not speculatively.

### `POST /food/user/survey/:surveyId/respond`
```json
{
  "answers": [
    { "questionId": "…", "answer": "Instagram" },
    { "questionId": "…", "answer": 5 }
  ]
}
```
`questionId` must be one of the `_id`s from the `questions[]` array the survey returned. `answer` can be a string, number, or array of strings (for multiple-choice). Submitting twice for the same survey returns a 400 — don't retry on failure without checking why.

*(Admin creates/activates surveys via `POST /food/admin/surveys` and `PATCH /food/admin/surveys/:id/status` — not needed by the customer-facing Flutter app, listed here only for completeness. Only one survey is ever active at a time.)*

---

## 7. Seller Delivery Fleet & Manual Assignment — Restaurant app + Delivery Partner app

Sellers running their own delivery boys get a fully manual dispatch flow — **no automatic assignment happens for these restaurants at all.**

### Restaurant app — `/food/restaurant/delivery-fleet` (Bearer, role RESTAURANT)

| Method | Path | Purpose |
|---|---|---|
| POST | `/food/restaurant/delivery-fleet/link` | Link an existing (already-approved) delivery partner into this seller's fleet, by phone |
| GET | `/food/restaurant/delivery-fleet` | List the seller's riders, each with current workload |
| DELETE | `/food/restaurant/delivery-fleet/:deliveryPartnerId` | Remove a rider from the fleet |
| POST | `/food/restaurant/orders/:orderId/assign-delivery` | Manually assign a rider to a confirmed order |

`POST /food/restaurant/delivery-fleet/link`:
```json
{ "phone": "9876543210" }
```
The phone must belong to an existing, `approved` delivery partner account. A rider can only be linked to one seller at a time.

`GET /food/restaurant/delivery-fleet` → 
```json
{
  "fleet": [
    {
      "_id": "…", "name": "…", "phone": "…", "availabilityStatus": "online",
      "vehicleType": "…", "vehicleNumber": "…", "rating": 4.8, "totalDeliveries": 120,
      "activeOrderCount": 2          // ← use this for workload-aware manual assignment
    }
  ]
}
```
Show `activeOrderCount` prominently in the assignment UI so the seller can avoid overloading one rider — the backend doesn't auto-balance this, it's the seller's call, this is just the data to make it with.

`POST /food/restaurant/orders/:orderId/assign-delivery`:
```json
{ "deliveryPartnerId": "…" }
```
→ 200, `{ order }` (updated `dispatch.status: "assigned"`, `dispatch.deliveryPartnerId` set). Only works for riders in this seller's own fleet, and only for orders belonging to this restaurant that aren't already `accepted`/`delivered`/cancelled.

### Delivery partner app — going online is now zone-gated

The existing go-online/offline toggle (`PATCH` availability endpoint in DELIVERY_API_SPEC.md) now enforces: **if this rider is linked to a seller's fleet, they can only go online while their current GPS location is inside that seller's delivery zone.** Going online from outside it now returns a 400:
```json
{ "success": false, "message": "You can only go online while inside your seller's delivery zone" }
```
or, if no location was sent at all:
```json
{ "success": false, "message": "Location is required to go online" }
```
**Implication for the app**: always send fresh `latitude`/`longitude` (or `lat`/`lng`) with the go-online request for a fleet-linked rider — don't rely on a previously-saved location, and handle both error messages with a clear in-app explanation rather than a generic failure toast. Riders **not** linked to any seller's fleet are unaffected (legacy global behavior unchanged).

### Order confirmation window — now 3 minutes

The existing seller order-acceptance countdown (already shown somewhere in the restaurant app per RESTAURANT_API_SPEC.md) now defaults to **180 seconds** instead of 240. If not confirmed in time, the order auto-cancels as "not accepted by restaurant" exactly as before — no new endpoint, just a shorter default window. (Still overridable via admin business settings if a specific deployment needs a different value, 1–20 minutes.)
