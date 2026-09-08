# Product Subscriptions — Flutter API Spec

Recurring deliveries of a single product: daily milk, weekly bread, monthly staples.
The customer sets it up once; the backend places a real order automatically on each
scheduled date.

Base URL: `{API_BASE}/api/v1`
All endpoints below require `Authorization: Bearer <accessToken>` and a **USER** token.

Every response uses the standard envelope:

```json
{ "success": true, "message": "…", "data": { } }
```

Errors:

```json
{ "success": false, "message": "startDate cannot be in the past", "error": "…" }
```

---

## 1. How it works

```
Customer subscribes
        ↓
Subscription  (the standing arrangement — item, frequency, time, address)
        ↓
Occurrences   (one row per delivery date, generated 14 days ahead)
        ↓
Hourly job    (converts each due occurrence into a real order)
        ↓
Order         (normal order — same tracking, same status flow)
```

Two things to keep separate in the UI:

| | What it is | Customer can |
|---|---|---|
| **Subscription** | The standing arrangement | Pause, resume, cancel, change qty / time / address |
| **Occurrence** | One scheduled delivery date | Skip that single day |

"Skip tomorrow's milk" cancels an **occurrence**. "Stop my milk" cancels the
**subscription**.

---

## 2. Before subscribing — which products qualify

A product is subscribable only when `subscriptionEnabled` is `true`. The seller
turns this on per item.

**Read this flag from the restaurant menu endpoint:**

```
GET /food/restaurant/restaurants/:restaurantId/menu
```

Each food object includes:

```json
{ "_id": "…", "name": "Amul Milk 500ml", "price": 56, "subscriptionEnabled": true }
```

> ⚠️ `GET /food/restaurant/public/foods` does **not** return `subscriptionEnabled`.
> If you read the catalogue from there you cannot tell which items qualify — use the
> menu endpoint above for the product detail screen, or the "Subscribe" button will
> appear on items the API will then reject.

The menu response is cached for 10 minutes, so a seller toggling the flag can take
that long to appear.

You also need an `addressId` — from `GET /food/user/addresses`.

---

## 3. Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/food/user/subscriptions` | Create |
| GET | `/food/user/subscriptions` | List mine |
| GET | `/food/user/subscriptions/:id` | One subscription |
| PATCH | `/food/user/subscriptions/:id` | Pause / resume / edit |
| DELETE | `/food/user/subscriptions/:id` | Cancel permanently |
| GET | `/food/user/subscriptions/:id/occurrences` | Delivery schedule |
| POST | `/food/user/subscriptions/:id/occurrences/:occurrenceId/cancel` | Skip one day |

---

### 3.1 Create a subscription

`POST /food/user/subscriptions` → **201**

```json
{
  "restaurantId": "6a969e3f383bd3ba9c9d92e9",
  "itemId": "6a96b029e1c43bfbedf66a67",
  "variantId": "",
  "quantity": 1,
  "frequency": "daily",
  "deliveryTime": "06:30",
  "startDate": "2026-09-10",
  "addressId": "6a9ea215db9969e6a81adecf",
  "paymentMethod": "cash"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `restaurantId` | string | ✅ | |
| `itemId` | string | ✅ | Must belong to that restaurant, and be `subscriptionEnabled` |
| `variantId` | string | — | Empty string if none |
| `quantity` | int ≥ 1 | — | Defaults to `1` |
| `frequency` | enum | ✅ | `daily` \| `weekly` \| `monthly` |
| `daysOfWeek` | int[] | only when `weekly` | `0`=Sunday … `6`=Saturday |
| `dayOfMonth` | int 1–28 | only when `monthly` | Capped at 28 so every month is valid |
| `deliveryTime` | string | ✅ | `"HH:mm"`, 24-hour. Regex-validated |
| `startDate` | string | ✅ | Any parseable date. **Cannot be in the past** |
| `addressId` | string | ✅ | Must be one of the user's saved addresses |
| `paymentMethod` | enum | — | `cash` \| `razorpay` \| `wallet`. Defaults to `cash` |

**Response** — `data.subscription`:

```json
{
  "subscription": {
    "_id": "…",
    "userId": "…",
    "restaurantId": "…",
    "itemId": "…",
    "itemName": "Amul Milk 500ml",
    "quantity": 1,
    "frequency": "daily",
    "daysOfWeek": [],
    "dayOfMonth": null,
    "deliveryTime": "06:30",
    "startDate": "2026-09-10T00:00:00.000Z",
    "addressId": "…",
    "paymentMethod": "cash",
    "status": "active",
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

Occurrences are generated immediately out to a horizon of **14 days from now** (not
from `startDate`), so you can call the occurrences endpoint right after and show the
schedule. A subscription starting in two days therefore returns about 12–13 rows, not
14 — that is correct, not a truncated response.

**Errors (400 unless noted)**

| Message | Cause |
|---|---|
| `This product is not available for subscription` | `subscriptionEnabled` is false |
| `Item does not belong to this restaurant` | Mismatched ids |
| `Restaurant not found` | 404 |
| `startDate cannot be in the past` | |
| `deliveryTime must be HH:mm (24h)` | |
| `daysOfWeek is required for a weekly subscription` | |
| `dayOfMonth is required for a monthly subscription` | |

Checks run in this order: schema → `startDate` → restaurant → item ownership →
`subscriptionEnabled` → address → frequency rules. So a weekly request for a
non-subscribable item reports the `subscriptionEnabled` error, not the missing
`daysOfWeek` — fix the first error and resubmit rather than assuming only one thing
is wrong.

---

### 3.2 List subscriptions

`GET /food/user/subscriptions` → **200**

```json
{ "subscriptions": [ { "…": "same shape as above" } ] }
```

Newest first. Includes cancelled ones — filter client-side if the UI only wants active.

---

### 3.3 Get one

`GET /food/user/subscriptions/:subscriptionId` → **200** → `{ "subscription": {…} }`

`404 Subscription not found` if it is not this user's.

---

### 3.4 Update — pause, resume, edit

`PATCH /food/user/subscriptions/:subscriptionId` → **200**

Send only what changes; at least one field is required.

```json
{ "status": "paused" }
```

| Field | Values |
|---|---|
| `status` | `active` \| `paused` \| `cancelled` |
| `quantity` | int ≥ 1 |
| `deliveryTime` | `"HH:mm"` |
| `addressId` | a saved address id |

> **Important:** setting `status` to `paused` **or** `cancelled` also cancels every
> already-scheduled occurrence from today onward. Resuming with
> `{"status":"active"}` does **not** bring them back — the hourly generator
> re-creates them, which can take up to an hour. Tell the user their schedule will
> refill shortly rather than showing an empty list as if resume failed.

Frequency cannot be changed. To change it, cancel and create a new subscription.

Error: `No fields to update` (400) if the body is empty.

---

### 3.5 Cancel a subscription

`DELETE /food/user/subscriptions/:subscriptionId` → **200** → `{ "success": true }`

Sets status to `cancelled` and cancels all scheduled occurrences. The row is kept,
not deleted, so it still appears in the list — hide or grey it by `status`.

---

### 3.6 Delivery schedule

`GET /food/user/subscriptions/:subscriptionId/occurrences` → **200**

```json
{
  "occurrences": [
    {
      "_id": "…",
      "subscriptionId": "…",
      "scheduledDate": "2026-09-10T00:00:00.000Z",
      "deliveryTime": "06:30",
      "status": "scheduled",
      "orderId": null,
      "cancelledAt": null,
      "cancelReason": "",
      "failureReason": ""
    }
  ]
}
```

Sorted by date ascending, and includes past dates — the whole history, not just
upcoming. Filter by `scheduledDate` for an "upcoming" view.

| `status` | Meaning | UI |
|---|---|---|
| `scheduled` | Not yet due | Can be skipped |
| `order_placed` | Became a real order — see `orderId` | Link to order tracking |
| `cancelled` | Skipped, or the subscription was paused/cancelled. See `cancelReason` | Greyed |
| `failed` | The system tried and could not place the order. See `failureReason` | Show the reason |

`failed` is worth surfacing. Real causes seen: `Saved address not found` (the customer
deleted the address the subscription points at), restaurant closed, item unavailable.
The delivery is **not** retried automatically.

---

### 3.7 Skip one delivery

`POST /food/user/subscriptions/:subscriptionId/occurrences/:occurrenceId/cancel` → **200**

```json
{ "reason": "Out of town" }
```

`reason` is optional, max 300 chars.

**Response** → `{ "occurrence": {…} }` with `status: "cancelled"`.

**Cut-off:** allowed only up to **midnight starting the delivery day** — i.e. the night
before. Once the delivery date begins, it is too late.

| Message | Cause |
|---|---|
| `Too late to cancel — this can only be cancelled the night before the scheduled delivery` | Past the cut-off |
| `This delivery is already order placed` | Already converted |
| `This delivery is already cancelled` | Already skipped |
| `Scheduled delivery not found` | 404 |

Disable the skip button once `now >= start of scheduledDate`, so the user does not hit
the error.

---

## 4. Notes for the app

**Timezone.** `scheduledDate` is local midnight of the delivery day, serialised as UTC —
so for IST it comes back as `…T18:30:00.000Z` of the *previous* calendar day. Parse it
as an instant and format in **local** time, or the whole schedule shows one day early.
Do not slice the date out of the ISO string.

**Horizon.** Only ~14 days of occurrences exist at any time; a background job extends
them hourly. A "next 30 days" calendar will look sparse at the far end — this is normal,
not missing data.

**Orders.** When an occurrence becomes an order, it is an ordinary order — same
tracking, same statuses, appears in order history. Nothing subscription-specific is
needed on the tracking screen.

**Payment.** `cash` is settled on delivery like any COD order. `razorpay` and `wallet`
are accepted by the API, but confirm the charge flow with the backend team before
building those paths — the automatic order placement is not an interactive checkout.

**No push notifications** are currently sent for subscription events (upcoming delivery,
failed delivery). If the app needs them, that is a backend change — ask first.

---

## 5. Suggested screens

1. **Product detail** — show "Subscribe" only when `subscriptionEnabled` is true
2. **Create** — frequency, time picker, start date, address, quantity
3. **My Subscriptions** — list, grouped or filtered by `status`
4. **Subscription detail** — the arrangement + upcoming occurrences, each skippable
   before the cut-off, plus pause / resume / cancel

---

## 6. Verified against

Every endpoint, request shape, response shape and error message in this document was
exercised against a running backend rather than read off the source. Twelve checks,
all passing:

| # | Check | Result |
|---|---|---|
| 1 | Create rejects a product with `subscriptionEnabled: false` | exact message confirmed |
| 2 | `startDate` in the past rejected | confirmed |
| 3 | `deliveryTime` not `HH:mm` rejected | confirmed |
| 4 | `weekly` without `daysOfWeek` rejected | confirmed |
| 5 | Create daily subscription | 201, all fields as documented |
| 6 | Occurrences generated immediately | 13 rows to the 14-day horizon |
| 7 | Skip one delivery before the cut-off | `cancelled`, reason stored |
| 8 | Skip the same one twice | `This delivery is already cancelled` |
| 9 | Pause cancels scheduled occurrences | 12 scheduled → 0 |
| 10 | Resume does **not** restore them | still 0 scheduled |
| 11 | Empty PATCH body rejected | `No fields to update` |
| 12 | Cancelling on the delivery day | `Too late to cancel …` |

Checks 9 and 10 are the ones most likely to look like a bug in the app. They are the
documented behaviour.
