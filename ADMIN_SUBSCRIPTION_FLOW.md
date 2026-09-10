# Admin-Created Subscriptions — What the Flutter App Must Know

Until now a product subscription could only begin one way: the customer created it in
the app. Admin could look at subscriptions but not start one.

Admin can now start a subscription **on a customer's behalf** — for the customer who
phones the shop instead of using the app. This document is about what that changes for
the customer app.

The customer-facing API is unchanged. Every endpoint, request shape and response shape
in **[`SUBSCRIPTION_API_SPEC.md`](SUBSCRIPTION_API_SPEC.md)** still applies exactly as
written. Read that first; this is a delta, not a replacement.

---

## 1. The one thing that actually changes for the app

> **A subscription can now appear in the customer's list that the customer never
> created on this device — or on any device.**

Everything else follows from that sentence.

If the app builds its subscription list from local state — "I POSTed it, so I know about
it" — that list is now wrong the moment someone rings the shop. The list must come from
`GET /food/user/subscriptions`, and it must be re-fetched when the customer opens the
screen, not only after the app itself created something.

Concretely:

| If the app does this today | Do this instead |
|---|---|
| Caches the list and only appends after its own `POST` | Re-fetch on screen focus / pull-to-refresh |
| Shows "No subscriptions" from a cached empty list | Re-fetch before rendering the empty state |
| Assumes the first subscription was created in this session | Assume nothing about origin |
| Derives "has subscriptions" from a local flag | Derive it from the server response |

There is no push notification when an admin creates one. The customer finds out by
opening the app — so a stale cache is the whole risk, and a re-fetch is the whole fix.

---

## 2. What it looks like — identical

An admin-created subscription is not a different kind of object. It is written by the
same service, through the same validator, with the same rules:

- Same collection, same document shape — **no `createdBy` field, no origin marker**
- Same `status` lifecycle: `active` → `paused` → `cancelled`
- Occurrences pre-generated the same way, on the same ~14-day rolling horizon
- Turns into an ordinary order on each delivery date, exactly as before

**The app cannot tell an admin-created subscription from a customer-created one, and
should not try.** There is no flag to branch on. Render them all the same way.

The customer keeps full control of it: they can pause, resume, cancel, and skip
individual deliveries through the endpoints they already use. An arrangement that
started on the phone is still theirs.

---

## 3. Where these come from — the admin flow

Useful context for reading bug reports; nothing here needs app code.

```
Customer phones the shop
        ↓
Admin → Subscriptions → "New subscription"
        ↓
   search customer (name or phone)
        ↓
   pick delivery address  ← must be one the CUSTOMER has already saved
        ↓
   pick store → product   ← only products with subscriptionEnabled: true
        ↓
   quantity · frequency · time · start date · payment
        ↓
POST /food/admin/product-subscriptions
        ↓
same createSubscription() the app calls  →  occurrences generated immediately
```

The form only offers choices the server will accept. Two of its refusals are worth
knowing because they land back on the app as customer-facing tasks:

| Admin sees | Customer has to |
|---|---|
| "This customer has no saved address" | Add an address in the app |
| "No map location saved — an order cannot be delivered here" | Re-select the address **on the map** |

Both exist because an order cannot be written without coordinates — the `2dsphere`
index on the delivery address rejects a point with no position. If the app lets a
customer save an address without dropping a pin, those addresses are unusable for
subscriptions **and** for ordinary delivery. Worth checking on the app side.

---

## 4. Admin endpoints — for reference

Only relevant if you also build admin tooling. These require an **ADMIN** token with
`order_management: create` (the subscription POST) and `customer_management: view`
(the address lookup).

### 4.1 Create a subscription for a customer

`POST /food/admin/product-subscriptions` → **201**

Identical body to the customer's `POST /food/user/subscriptions`, plus one field:

```json
{
  "customerId": "6aa26f1b2c9d4e8a71f0c331",
  "restaurantId": "6a990defccffbf208abaadf5",
  "itemId": "6a990e0bccffbf208abaae0c",
  "quantity": 2,
  "frequency": "weekly",
  "daysOfWeek": [1, 4],
  "deliveryTime": "06:30",
  "startDate": "2026-09-10",
  "addressId": "6aa26f1b2c9d4e8a71f0c332",
  "paymentMethod": "cash"
}
```

| Field | Notes |
|---|---|
| `customerId` | **Admin only.** The app takes this from the token; an admin must state it |
| everything else | Exactly as documented in `SUBSCRIPTION_API_SPEC.md` §3.1 |

Response — `data.subscription`, in the admin list shape (customer and restaurant names
resolved, not just ids):

```json
{
  "subscription": {
    "id": "6aa2930f…",
    "customer": { "id": "6aa26f1b…", "name": "Meena Sharma", "phone": "9876500001" },
    "restaurantId": "6a990def…",
    "restaurantName": "Demo Test Store",
    "itemId": "6a990e0b…",
    "itemName": "Masala Lemonade",
    "itemImage": "",
    "quantity": 2,
    "frequency": "weekly",
    "daysOfWeek": [1, 4],
    "dayOfMonth": null,
    "deliveryTime": "06:30",
    "startDate": "2026-09-09T18:30:00.000Z",
    "paymentMethod": "cash",
    "status": "active",
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

Errors:

| Status | Message | Cause |
|---|---|---|
| 400 | `Invalid customerId` | Not an ObjectId |
| 404 | `Customer not found` | No such customer |
| 400 | `This customer account is deactivated — reactivate it before starting a subscription` | `isActive: false` |
| 400 | `This product is not available for subscription` | `subscriptionEnabled` is not `true` |
| 400 | `Item does not belong to this restaurant` | Mismatched store |
| 400 | `Saved address not found` | `addressId` is not this customer's |
| 400 | `startDate cannot be in the past` | |
| 400 | `deliveryTime must be HH:mm (24h)` | |
| 400 | `daysOfWeek is required for a weekly subscription` | |
| 400 | `dayOfMonth is required for a monthly subscription` | |
| 401 | `Authentication token missing` | No admin token |

### 4.2 A customer's saved addresses

`GET /food/admin/customers/:id/addresses` → **200**

```json
{
  "customer": { "id": "6aa26f1b…", "name": "Meena Sharma", "phone": "9876500001" },
  "addresses": [
    {
      "id": "6aa26f1b2c9d4e8a71f0c332",
      "label": "Home",
      "line": "402, Green Park, Road No 5, Hyderabad, Telangana, 500034",
      "city": "Hyderabad",
      "zipCode": "500034",
      "phone": "9876500001",
      "isDefault": true,
      "hasLocation": true
    }
  ]
}
```

`hasLocation` is `false` for legacy rows saved before coordinates were captured. Such an
address cannot receive an order — offer it disabled, never as a valid choice.

### 4.3 Subscribable products for a store

`GET /food/admin/foods?restaurantId=<id>&subscriptionEnabled=true&limit=500`

The `subscriptionEnabled` filter is new. Without it the picker offers products the
create call will then refuse.

---

## 5. Two behaviours that look like bugs and are not

**A monthly subscription can show an empty schedule.** Occurrences are pre-generated
only ~14 days ahead. A subscription created on 10 September for "day 1 of the month"
has its first delivery on 1 October — outside the window — so it has **zero**
occurrences until the rolling job catches up around 17 September. The subscription is
`active` and correct; the schedule is simply empty. Do not render this as a failure.

**Pausing cancels the scheduled deliveries, and resuming does not bring them back.**
This is pre-existing behaviour, documented in `SUBSCRIPTION_API_SPEC.md` §6 checks 9–10.
It applies identically to admin-created subscriptions. After a resume, the schedule
refills from the next rolling generation, not instantly.

---

## 6. Known gaps

Not defects — decisions, recorded so nobody rediscovers them as surprises.

- **No audit trail.** The subscription document has no `createdBy`, so nothing records
  that an admin started it, or which admin. If that matters for disputes, it is a
  model change — raise it before relying on it.
- **Admin cannot pause or cancel.** Admin can start a subscription and read it; editing
  stays with the customer. An admin who creates one by mistake cannot undo it from the
  panel — the customer has to cancel it in the app.
- **No notification to the customer.** Nothing tells them a subscription now exists.
  Whoever takes the call has to say so.

---

## 7. Verified against

Everything above was exercised against a running backend and a running admin panel, not
read off the source.

**Backend — 15 integration tests** (`Backend/tests/productSubscriptionAdmin.test.js`),
all passing, inside a full suite of 103:

| # | Check | Result |
|---|---|---|
| 1 | Creates the arrangement and pre-generates its deliveries | 14+ occurrences, owned by the customer |
| 2 | The new row appears in the admin list and is searchable by phone and item | confirmed |
| 3 | Weekly rule carried through | every occurrence falls on a chosen weekday |
| 4 | Monthly rule carried through | `daysOfWeek` cleared, not carried over |
| 5 | Product with `subscriptionEnabled: false` refused | exact message confirmed |
| 6 | Product from a different store refused | confirmed |
| 7 | Another customer's address refused | confirmed |
| 8 | `startDate` in the past refused | confirmed |
| 9 | Weekly without days, monthly without a day, refused | confirmed |
| 10 | `deliveryTime` not `HH:mm` refused | confirmed |
| 11 | Unknown and malformed `customerId` refused | 404 / 400 |
| 12 | Deactivated customer refused | confirmed |
| 13 | Address list renders as one readable line each | confirmed |
| 14 | Legacy address with no coordinates flagged `hasLocation: false` | confirmed |
| 15 | Unknown customer returns nothing | confirmed |

**Browser — the admin panel, end to end:**

| Check | Result |
|---|---|
| Customer search by name and by phone | both return the customer |
| Addresses load on pick, default pre-selected | confirmed |
| Product list shows only subscribable items | 2 of 10 products offered |
| Weekly with no weekday selected blocks submit | "Pick at least one weekday" |
| Customer with no saved address blocks submit | warning shown, submit disabled |
| Create weekly Mon+Thu | 5 occurrences generated, **all** on Mon or Thu |
| Detail dialog lists the generated deliveries | 10, 14, 17, 21, 24 September |
| Monthly day 1, created 10 Sept | 0 occurrences — first delivery 1 Oct, past the horizon |

**HTTP layer, direct:** non-subscribable product → 400 · past `startDate` → 400 ·
bad `deliveryTime` → 400 · unknown customer → 404 · no token → 401.
