# Wishlist — Flutter API Spec

Products a customer saved to come back to. Any product from any store can go on it.

Base URL: `{API_BASE}/api/v1`
Every endpoint below requires `Authorization: Bearer <accessToken>` and a **USER** token.

Standard envelope:

```json
{ "success": true, "message": "…", "data": { } }
```

Errors:

```json
{ "success": false, "message": "Invalid food id", "error": "Invalid food id" }
```

> **One list, two kinds of thing.** These endpoints back both the product wishlist and
> saved stores — same collection, different `entityType`. A single `GET` returns both,
> so the app fetches once and fills both screens.

---

## 1. What the app needs to know first

**The wishlist is server-side and per customer.** Until recently the web app kept it in
local storage and never called these endpoints, so a customer's list did not follow them
between devices. It does now. If your app has been holding its own copy, push it up once
on sign-in (§4.4) and then treat the server as the source of truth — otherwise the same
customer sees two different lists on two devices.

**Every write is idempotent, in both directions.** Adding something already on the list
succeeds. Removing something that was never on it succeeds. You do not need a debounce
on the heart, and a retry after a dropped response is safe.

---

## 2. Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/food/user/favorites` | The whole list — products and stores |
| POST | `/food/user/favorites/foods/:foodId` | Add a product |
| DELETE | `/food/user/favorites/foods/:foodId` | Remove a product |
| POST | `/food/user/favorites/restaurants/:restaurantId` | Save a store |
| DELETE | `/food/user/favorites/restaurants/:restaurantId` | Unsave a store |

---

### 2.1 Get the wishlist

`GET /food/user/favorites` → **200**

```json
{
  "success": true,
  "message": "Favorites fetched",
  "data": {
    "foodIds": ["6a99279cb8c5893c1f94613b"],
    "restaurantIds": ["6a990defccffbf208abaadf5"],
    "foods": [
      {
        "_id": "6a99279cb8c5893c1f94613b",
        "name": "Chocolate Brownie",
        "description": "Warm fudgy brownie with chocolate sauce",
        "price": 149,
        "otherPrice": 0,
        "image": "https://…",
        "images": ["https://…"],
        "foodType": "Veg",
        "isAvailable": true,
        "rating": 0,
        "totalRatings": 0,
        "variants": [],
        "restaurantId": "6a990defccffbf208abaadf5",
        "restaurantName": "Demo Test Store"
      }
    ],
    "restaurants": [
      {
        "_id": "6a990defccffbf208abaadf5",
        "restaurantName": "Demo Test Store",
        "coverImage": "",
        "coverImages": [],
        "cuisines": [],
        "rating": 0,
        "totalRatings": 0,
        "isAcceptingOrders": true,
        "location": { "type": "Point", "coordinates": [78.4867, 17.385], "latitude": 17.385, "longitude": 78.4867 }
      }
    ]
  }
}
```

Newest first, in both lists.

**`foodIds` and `foods` are not the same length, and that is deliberate.** Read §4.1
before you build the screen — it is the single most likely thing to look like a bug.

---

### 2.2 Add a product

`POST /food/user/favorites/foods/:foodId` → **200**

No request body.

```json
{
  "success": true,
  "message": "Dish added to favorites",
  "data": { "favorited": true, "entityType": "food", "entityId": "6a99279cb8c5893c1f94613b" }
}
```

Sending it again returns exactly the same thing and does not add a second entry.

---

### 2.3 Remove a product

`DELETE /food/user/favorites/foods/:foodId` → **200**

```json
{
  "success": true,
  "message": "Dish removed from favorites",
  "data": { "favorited": false, "entityType": "food", "entityId": "6a99279cb8c5893c1f94613b" }
}
```

Removing something that was never on the list returns the same success.

---

### 2.4 Save / unsave a store

`POST` and `DELETE /food/user/favorites/restaurants/:restaurantId` → **200**

Identical shape, with `"entityType": "restaurant"` and the messages
`Store added to favorites` / `Store removed from favorites`.

---

### 2.5 Errors

| Situation | Status | `message` |
|---|---|---|
| `:foodId` is not a valid id | 400 | `Invalid food id` |
| `:restaurantId` is not a valid id | 400 | `Invalid restaurant id` |
| No / bad token | 401 | `Authentication token missing` |

A well-formed id that belongs to no product is **not** an error — it is accepted and
simply never appears in `foods`. See §4.1.

---

## 3. Data model, for your local cache

```dart
class WishlistProduct {
  final String id;            // _id
  final String name;
  final String? description;
  final num price;            // current selling price
  final num? otherPrice;      // struck-through price; 0 means none
  final String image;         // image, else images.first, else ''
  final String foodType;      // "Veg" | "Non-Veg"
  final bool isAvailable;
  final String restaurantId;
  final String restaurantName;
}
```

`price` is what the product costs **today**, not what it cost when it was wishlisted —
these rows are read live from the catalogue on every call. A price on a wishlist card can
legitimately differ from what the customer remembers.

---

## 4. Notes for the app

### 4.1 `foodIds` fills hearts; `foods` renders cards

- **`foodIds`** — every product the customer wishlisted, always. Bind the heart icon to
  this. A product that has since been delisted, rejected or deleted **stays in this list**,
  so the heart the customer tapped stays filled.
- **`foods`** — only products that are still orderable. This is what the wishlist screen
  renders.

So `foodIds.length >= foods.length`, and the difference is products that quietly stopped
being sold. If you build the heart state from `foods`, a customer's heart un-fills on its
own and it looks like their tap was lost.

Show the count from `foods`. Nobody wants "12 saved" over a screen with 9 cards.

### 4.2 There is no stored slug

If your routing uses a store slug, derive it from `restaurantName` the way the rest of the
app does:

```dart
final slug = restaurantName.toLowerCase().replaceAll(RegExp(r'\s+'), '-');
```

The backend has no slug column to return.

### 4.3 Optimistic writes are safe

Fill the heart on tap, then call. If the call fails, roll back. Because both writes are
idempotent, a retry cannot corrupt anything, and you do not need to serialise taps.

### 4.4 Merging a guest's list on sign-in

If you let a signed-out customer wishlist things locally, push them up once the token
arrives, then replace local state with the server's reply:

```dart
await Future.wait(localIds.map((id) => api.addFavoriteFood(id)));  // idempotent
final serverList = await api.getFavorites();                        // now authoritative
```

Do it in that order. Fetching first and pushing after loses anything saved as a guest.

### 4.5 What is not here

- **No pagination.** The whole list comes back in one call. Fine at the sizes seen so far;
  if a customer ever wishlists thousands, this is the endpoint that will need it.
- **No "notify me when back in stock".** `isAvailable` tells you the current state; nothing
  watches it for the customer.
- **No note or quantity per item.** A wishlist row is just the product.
- **No ordering control.** Newest first, fixed.

---

## 5. Suggested screens

**Wishlist tab** — cards from `foods`: image, name, store name, price, a filled heart that
removes, and a tap through to the product. Empty state when `foods` is empty.

**Heart on every product card and product page** — filled when `foodIds` contains the id.
One `GET` at app start is enough to drive every heart in the session; update the set
locally on each write rather than refetching.

---

## 6. Verified against

Every path, payload and error message above was exercised against a running backend over
HTTP with a real user token, not read off the source.

| # | Check | Result |
|---|---|---|
| 1 | Add a product | 200, `favorited: true`, message as documented |
| 2 | Add the same product again | same response, list length unchanged |
| 3 | `GET` returns `foodIds`, `restaurantIds`, `foods`, `restaurants` | confirmed |
| 4 | Product row carries `restaurantName` | confirmed |
| 5 | Remove a product | 200, `favorited: false` |
| 6 | Remove one never wishlisted | 200, same shape — not an error |
| 7 | Save / unsave a store | 200, `entityType: "restaurant"` |
| 8 | `:foodId` not an id | 400 `Invalid food id` |
| 9 | `:restaurantId` not an id | 400 `Invalid restaurant id` |
| 10 | No token | 401 `Authentication token missing` |
| 11 | Added on one client, read back on another | appeared without any local state |
| 12 | Delisted a wishlisted product, re-read | `foodIds` 2, `foods` 1 — id kept, card dropped |
| 13 | Well-formed id belonging to no product | 200, listed in `foodIds`, never in `foods` |
| 14 | Two concurrent adds of the same product | one entry, and one remove clears it |

Checks 6, 12 and 13 are the ones most likely to be read as bugs. They are the documented
behaviour.

Backed by 13 integration tests in `Backend/tests/userFavorites.test.js`, including check 14
run both with and without the unique index in place — the state a freshly deployed backend
is in for its first few moments.

---

## 7. Related

- [`SUBSCRIPTION_API_SPEC.md`](SUBSCRIPTION_API_SPEC.md) — recurring deliveries
- [`USER_APP_API.md`](USER_APP_API.md) — the rest of the customer app's surface
