# Delivery Slots — Flutter implementation guide

Everything needed to build slot booking into the customer app: the endpoints, the data
shapes, the screen-by-screen behaviour, and the rules that are not obvious from the API
alone. Section 11 lists what was tested and how.

**Base URL:** `{host}/api/v1`
**Auth:** Bearer token, except where a section says otherwise.

---

## 1. The one idea

A **delivery slot** is a window the customer books a delivery into — "Morning 7–8 AM" —
instead of taking it as soon as the shop can send it.

**Instant is not a slot.** An order placed with no slot goes out immediately, on exactly
the path it took before slots existed. An app that never sends a slot keeps working
unchanged. Everything in this document is additive.

So the choice on the cart screen is two options, not one list:

```
(•) Instant        We start packing straight away
( ) Pick a slot    Choose the window you want it delivered in
```

The window list appears only under the second. Never put "Instant" inside the slot list
as if it were a window.

Slots are configured centrally by the admin and are the same for every shop. A
deployment with none configured returns an empty list — hide the "Pick a slot" option
entirely rather than showing an empty picker.

### The mental model that prevents most bugs

A booking is **a live order that is not in progress**. It belongs in the orders list and
on the current-order surface, but nothing is being cooked, no rider is looking for it,
and its ETA is not "a few minutes from now". Almost every bug found while building this
came from treating a booking like an order that had just arrived.

---

## 2. Endpoints at a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/food/restaurant/delivery-slots?date=` | none | The windows on offer for a day |
| POST | `/food/orders` | user | Place an order, with or without a window |
| PATCH | `/food/orders/{orderId}/cancel` | user | Cancel — works on a booking while `confirmed` |
| GET | `/food/orders` | user | Orders list |
| GET | `/food/orders/{orderId}` | user | One order |
| POST | `/food/user/subscriptions` | user | Standing arrangement on a window |
| GET | `/food/admin/delivery-slots` | admin | Manage windows |
| POST | `/food/admin/delivery-slots` | admin | Create |
| PATCH | `/food/admin/delivery-slots/{slotId}` | admin | Update / restore |
| DELETE | `/food/admin/delivery-slots/{slotId}` | admin | Retire (never deletes) |

---

## 3. Data shapes

### Slot (from the public read)

```json
{
  "id": "6aa3d665eb870c2dba072917",
  "label": "Morning 7-8 AM",
  "startTime": "07:00",
  "endTime": "08:00",
  "cutoffMinutes": 60,
  "capacity": null,
  "daysOfWeek": [],
  "isActive": true,
  "sortOrder": 0,
  "deliveryAt": "2026-09-12T01:30:00.000Z",
  "ordersClose": "2026-09-12T00:30:00.000Z",
  "booked": 1,
  "available": false,
  "reason": "Orders for this slot have closed"
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | String | Send this back when booking |
| `label` | String | Customer-facing name — show this, not the raw times alone |
| `startTime` / `endTime` | String `"HH:mm"` | 24-hour, the shop's local clock |
| `cutoffMinutes` | int | How long before `startTime` ordering for it stops |
| `capacity` | int? | Orders the window takes per day. `null` = uncapped |
| `daysOfWeek` | List\<int\> | Empty = every day. Otherwise `0`=Sunday … `6`=Saturday |
| `deliveryAt` | DateTime | When it lands: the start of the window on that day |
| `ordersClose` | DateTime | The moment ordering for it stops |
| `booked` | int | Orders already in it **for that day** — only meaningful on a capped window; always `0` when `capacity` is `null`, because nothing is counted where nothing contends |
| `available` | bool | Whether it can still be taken |
| `reason` | String | Why not, when `available` is false. Empty otherwise |

`isActive` and `sortOrder` are admin bookkeeping — the list is already sorted and only
active slots are returned, so ignore both.

```dart
class DeliverySlot {
  final String id;
  final String label;
  final String startTime;   // "07:00"
  final String endTime;     // "08:00"
  final int? capacity;      // null = uncapped
  final DateTime deliveryAt;
  final DateTime ordersClose;
  final int booked;
  final bool available;
  final String reason;      // "" when available

  const DeliverySlot({
    required this.id,
    required this.label,
    required this.startTime,
    required this.endTime,
    required this.capacity,
    required this.deliveryAt,
    required this.ordersClose,
    required this.booked,
    required this.available,
    required this.reason,
  });

  factory DeliverySlot.fromJson(Map<String, dynamic> j) => DeliverySlot(
        id: j['id'] as String,
        label: j['label'] as String? ?? '',
        startTime: j['startTime'] as String? ?? '',
        endTime: j['endTime'] as String? ?? '',
        capacity: j['capacity'] as int?,
        deliveryAt: DateTime.parse(j['deliveryAt'] as String).toLocal(),
        ordersClose: DateTime.parse(j['ordersClose'] as String).toLocal(),
        booked: j['booked'] as int? ?? 0,
        available: j['available'] as bool? ?? false,
        reason: j['reason'] as String? ?? '',
      );

  String get window => '$startTime–$endTime';
}
```

### The window as stored on an order or subscription

```json
"deliverySlot": {
  "slotId": "6aa3d665eb870c2dba072917",
  "label": "Morning 7-8 AM",
  "startTime": "07:00",
  "endTime": "08:00"
}
```

An order with no window has `slotId: null` and empty strings — **test `slotId`, not the
presence of the object.**

This is a **snapshot**. Renaming or retiring the slot later does not rewrite what a
placed order says, so render `order.deliverySlot.label` directly; never look the slot up
again by id.

```dart
class BookedWindow {
  final String slotId;
  final String label;
  final String startTime;
  final String endTime;

  const BookedWindow({required this.slotId, required this.label,
                      required this.startTime, required this.endTime});

  static BookedWindow? fromJson(Map<String, dynamic>? j) {
    final id = j?['slotId'];
    if (id == null || (id is String && id.isEmpty)) return null;  // instant order
    return BookedWindow(
      slotId: id as String,
      label: j!['label'] as String? ?? '',
      startTime: j['startTime'] as String? ?? '',
      endTime: j['endTime'] as String? ?? '',
    );
  }
}
```

---

## 4. Showing the windows

`GET /food/restaurant/delivery-slots?date=YYYY-MM-DD` → **200**

**No auth.** Whether the shop delivers at 7am is part of deciding whether to order at
all, so this is readable before signing in.

| Query | Required | Notes |
|---|---|---|
| `date` | no | `YYYY-MM-DD`, read as a **local calendar day**, not a UTC instant. Omit for today |

```json
{
  "success": true,
  "message": "Available slots",
  "data": { "date": "2026-09-10T18:30:00.000Z", "slots": [ /* … */ ] }
}
```

### Rule 1 — show the windows that cannot be taken

**Render every slot the endpoint returns, including unavailable ones.** A closed or full
window comes back with `available: false` and a `reason` that is written to go on screen:

| `reason` | When |
|---|---|
| `"Orders for this slot have closed"` | Past the cut-off — today only |
| `"This slot is full"` | `booked` has reached `capacity` for that day |

Grey it out, make it untappable, put the reason under the times.

A list that silently omits the 7am window teaches the customer the shop does not deliver
then, and they stop looking. Told that orders for it closed, they come back tomorrow.
This is the single most important rule in this document.

### Rule 2 — the day matters

The cut-off applies to **today only**. The same window is open for tomorrow even when
today's has closed: at 11pm tonight, today's 7am slot is shut and tomorrow's is not.

Capacity is likewise per day — a window full tomorrow says nothing about the day after.

Offer the next few days as chips (the web app offers four: today plus three) and
re-fetch on every change. Pre-select the first window with `available: true`; if none is
available, keep the list visible with its reasons and say every window that day is taken.

### Errors

| Status | `message` | Cause |
|---|---|---|
| 400 | `date must be in YYYY-MM-DD format` | Any other date format |

---

## 5. Placing a booking

`POST /food/orders` — the existing create-order call, plus two fields.

| Field | Type | Notes |
|---|---|---|
| `deliverySlotId` | String | The `id` of the window the customer picked |
| `deliveryDate` | String | `YYYY-MM-DD`, the day it is for |

Omit both for an instant order.

### Send the slot id, never a timestamp

The server derives the delivery time from the window and **re-checks that it is still
open**. The list on screen may be minutes old by the time payment goes through, and a
window can close or fill in between — so a booking is only confirmed here, never at the
moment the customer taps it.

### Do not gate the picker on the shop's opening hours

A booked window is **not** measured against the shop's counter hours, on either side. A
7–8 AM round exists precisely because the counter is shut at 7am; checking one against
the other makes every early window pickable but unorderable.

If your checkout disables itself while the shop reads as closed, **skip the
opening-hours part when a slot is selected.** Keep it for instant orders, which really
do depend on the shop being open now.

**Set aside the clock only — not the shop's own switch.** A shop that has paused orders
(`isAcceptingOrders: false`) or been deactivated (`isActive: false`) is not taking
bookings either: closed for the day has to stop a 7am booking the same way it stops one
for right now. Booking against such a shop returns `Store is currently offline.` or
`Store is currently closed.`

### What comes back

A booking:

```json
"scheduledAt": "2026-09-12T01:30:00.000Z",
"deliverySlot": { "slotId": "6aa3…", "label": "Morning 7-8 AM",
                  "startTime": "07:00", "endTime": "08:00" }
```

An instant order:

```json
"scheduledAt": null,
"deliverySlot": { "slotId": null, "label": "", "startTime": "", "endTime": "" }
```

### Errors

| Status | `message` | Cause |
|---|---|---|
| 400 | `Orders for this slot have closed` | Cut-off passed between listing and paying |
| 400 | `This slot is full` | Capacity reached between listing and paying |
| 400 | `That delivery slot is not available on the chosen day` | Slot does not run that weekday, or was retired |
| 400 | `Invalid delivery slot` | `deliverySlotId` is not an id |
| 400 | `Store is currently offline.` | Shop has paused orders |
| 400 | `Store is currently closed.` | Shop deactivated |

All of these use the same wording as the list and can be shown to the customer as-is. On
any of them, re-fetch the day's windows and let them pick again — the list will now show
the window with its reason.

`This slot is full` is the one to expect on a busy window: the last place is decided at
payment, not at tap, so two customers paying at the same moment for the same last place
will see one order placed and one refusal. **Treat it as a normal outcome, not an error
state.** These checks also run *before* the delivery-zone check, so a closed window
reports the window rather than "We don't deliver to this address yet".

---

## 6. After it is booked — the rules that are not in the API

This is where a naive implementation goes wrong. Everything below is behaviour the
backend already has; the app has to match it.

### 6.1 Count down to the window, not from the order

An ETA derived from `createdAt` plus a delivery estimate shows tomorrow's round as
arriving in minutes, then as permanently overdue. **If `scheduledAt` is in the future,
the time remaining is the time until `scheduledAt`.**

```dart
Duration? timeUntilDelivery(Order order) {
  final at = order.scheduledAt;
  if (at != null && at.isAfter(DateTime.now())) return at.difference(DateTime.now());
  return null; // fall through to your existing instant-order ETA
}
```

### 6.2 Say when it is coming, not "Preparing your order"

Nothing is being cooked until the window is close. Use the window the customer was
promised:

```dart
String? bookedForLabel(Order order) {
  final at = order.scheduledAt;
  if (at == null || !at.isAfter(DateTime.now())) return null;

  final now = DateTime.now();
  final isToday = DateUtils.isSameDay(at, now);
  final isTomorrow = DateUtils.isSameDay(at, now.add(const Duration(days: 1)));
  final day = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : DateFormat('d MMM').format(at);

  final w = order.deliverySlot;
  if (w != null) return '$day, ${w.startTime}–${w.endTime}';
  return '$day, ${DateFormat('hh:mm a').format(at)}';
}
// → "Arriving Tomorrow, 07:00–08:00"
```

### 6.3 Do not render hours as a minute count

A booking is hundreds of minutes out. Show the window time — `BOOKED 07:00` — not
`ETA 849m`.

### 6.4 A booking stays cancellable while `confirmed`

Cancelling an ordinary order stops once the shop accepts it, because it is already being
cooked. A booking is not being cooked, so `PATCH /food/orders/{orderId}/cancel` keeps
working on it **until its window opens or a rider is assigned**, whichever comes first.

- Show the cancel button on a booking in `confirmed`.
- Hide it on an instant order in `confirmed` — the call still returns
  `Order cannot be cancelled`.

Cancelling frees the place the booking held in its window. The refund is the full amount
with no time-based fee, however long ago it was booked.

### 6.5 Two things are deferred — do not wait for them at checkout

| | Ordinary order | Booking |
|---|---|---|
| Seller's acceptance clock | a few minutes | runs to the **start of the window** |
| Rider hunt | starts at checkout | starts about **30 min before the window** |

So on a booking, `acceptanceDeadlineAt` equals `scheduledAt`, and `dispatch.status` stays
`unassigned` for hours. Both are correct.

- Do not show "looking for a rider" on a booking until its window is close.
- Do not put a booking on a countdown card built for minutes — a 7am booking placed at
  midnight legitimately has seven hours on it.
- A booking still unaccepted when its window opens is cancelled as
  `cancelled_by_restaurant`, exactly as an ignored instant order is.

### 6.6 Push copy

The acceptance push on a booking names the window — *"The restaurant has accepted your
order. It will arrive tomorrow between 07:00 and 08:00."* — rather than saying the food
is being prepared, because a seller can accept a booking a day ahead. Nothing to do in
the app; noted so the copy does not look like a bug.

---

## 7. Subscribing to a window

`POST /food/user/subscriptions` takes a window instead of a typed time.

| Field | Type | Required | Notes |
|---|---|---|---|
| `deliverySlotId` | String | one of the two | Preferred — show windows, not a clock |
| `deliveryTime` | `"HH:mm"` | one of the two | Still accepted, for deployments with no slots |

Send one or the other; neither is rejected with `Pick a delivery slot`.

When a window is used, the subscription stores both — `deliveryTime` is set to the
window's `startTime`, so every existing screen that reads `deliveryTime` keeps working,
and `deliverySlot` carries the name and both ends. Show `deliverySlot.label` when
present, fall back to `deliveryTime` when not: older subscriptions have no window.

### A subscription is not judged against a single day

Picking a window for a subscription ignores both the cut-off and capacity. A subscription
is not competing for tomorrow's 7am van; it is asking to be on every 7am van. So
subscribing to a 7am window succeeds at 6:30pm, and succeeds when tomorrow's 7am is
already full.

**Build the subscription picker from the same endpoint but ignore `available` and
`reason` — every returned window is selectable.** Only the one-off order flow greys them
out.

Each occurrence, when it becomes a real order, carries the subscribed window and is timed
to its start on that day.

### Errors

| Status | `message` |
|---|---|
| 400 | `Pick a delivery slot` |
| 400 | `That delivery slot is not available` |
| 400 | `Invalid delivery slot` |

---

## 8. Admin endpoints

Bearer admin token; permission section `system_settings`. Only needed if the Flutter
build includes an admin console — the customer app uses section 4 only.

### List

`GET /food/admin/delivery-slots` → **200**, `data.slots`

| Query | Notes |
|---|---|
| `includeInactive` | Defaults to **true**. Pass `false` to omit retired slots |
| `withCoverage` | `true` adds `coverage: { open, total }` per slot |

`coverage` is how many approved shops keep hours covering the window, out of how many
there are. `open == 0` means nobody is open for it — say so on the screen, because
ordering into a window deliberately ignores counter hours and nothing else would tell the
admin that the 3 AM window they just published cannot be served. **Warn, do not block:**
publishing it is their call.

### Create

`POST /food/admin/delivery-slots` → **201**, `data.slot`

```json
{ "label": "Morning 7-8 AM", "startTime": "07:00", "endTime": "08:00",
  "cutoffMinutes": 60, "capacity": null, "daysOfWeek": [], "sortOrder": 0 }
```

| Field | Required | Notes |
|---|---|---|
| `label` | yes | |
| `startTime`, `endTime` | yes | `"HH:mm"`; end must be after start |
| `cutoffMinutes` | no | Defaults to `60`. `0` = orders taken up to the start |
| `capacity` | no | `null`/omitted = uncapped. Must be ≥ 1 if given |
| `daysOfWeek` | no | Empty = every day |
| `sortOrder` | no | Display order; ties break on `startTime` |

### Update

`PATCH /food/admin/delivery-slots/{slotId}` → **200**. Partial; send only what changes.
Both ends are validated together even when only one is sent, so a window cannot be edited
into ending before it starts one field at a time. `isActive: true` restores a retired
slot.

### Retire

`DELETE /food/admin/delivery-slots/{slotId}` → **200**, `Delivery slot retired`.

**This does not delete.** It sets `isActive: false`. Orders already booked into the
window still name it, and a deleted row would leave them pointing at nothing — the
customer's "arriving 7–8am" would go blank on an order that is still coming. Keep retired
slots visible in the admin list, greyed out, with a way to restore.

### Errors

| Status | `message` |
|---|---|
| 400 | `Slot label is required` |
| 400 | `startTime must be HH:mm (24h)` / `endTime must be HH:mm (24h)` |
| 400 | `A slot must end after it starts` |
| 400 | `capacity must be a whole number of at least 1` |
| 400 | `cutoffMinutes cannot be negative` |
| 400 | `daysOfWeek must be numbers 0 (Sunday) to 6 (Saturday)` |
| 400 | `No fields to update` |
| 404 | `Slot not found` — also for a malformed id |

---

## 9. Screen-by-screen checklist

**Cart**

- [ ] Default to Instant; send no slot fields. This is the unchanged path.
- [ ] "Pick a slot" reveals day chips (today + 3) and the windows for the selected day.
- [ ] Unavailable windows shown, greyed, with `reason` underneath.
- [ ] Pre-select the first `available` window; clear the selection when the day changes.
- [ ] Do not disable checkout because the shop is outside opening hours — but do disable
      it when the shop has paused orders or is deactivated.
- [ ] On place-order send `deliverySlotId` + `deliveryDate`; on any of the six errors in
      section 5, re-fetch and let them pick again.

**Order tracking / current order**

- [ ] Countdown runs to `scheduledAt` when it is in the future.
- [ ] Status line reads "Arriving Tomorrow, 07:00–08:00", not "Preparing your order".
- [ ] ETA chip shows the window time, not a minute count.
- [ ] No "looking for a rider" until the window is close.

**Orders list**

- [ ] A booking shows the day it is coming, not only when it was placed.

**Order actions**

- [ ] Cancel is available on a booking in `confirmed`; hidden on an instant order in
      `confirmed`.

**Subscriptions**

- [ ] Window picker from the same endpoint, `available`/`reason` ignored.
- [ ] Send `deliverySlotId`; fall back to a time picker only when the list is empty.
- [ ] Display `deliverySlot.label`, falling back to `deliveryTime`.

---

## 10. Timezone

`startTime`, `endTime` and `cutoffMinutes` are the shop's local wall-clock. `date` is a
local calendar day. `deliveryAt`, `ordersClose` and `scheduledAt` are absolute instants
in ISO 8601 — parse them and convert with `.toLocal()`; never string-slice them.

In the examples above the server is on IST, which is why `07:00` local appears as
`01:30Z`.

---

## 11. Verified against

Exercised against a running backend rather than read off the source. "HTTP" means the
call was made against the dev server and the response quoted is what came back; "tests"
means it is pinned by the backend suite; "browser" means it was done through the web UI
and read back out of the database; "code read" means it was established by reading the
implementation only.

| # | Check | Result | How |
|---|---|---|---|
| 1 | Two windows created and listed | 201, returned as documented | HTTP |
| 2 | `endTime` before `startTime` | 400 `A slot must end after it starts` | HTTP |
| 3 | Edit only `endTime` to before the stored start | 400, same message | tests |
| 4 | Create with no label | 400 `Slot label is required` | HTTP |
| 5 | `capacity: 0` | 400 `capacity must be a whole number of at least 1` | HTTP |
| 6 | `capacity: ""` | accepted as uncapped (`null`) | tests |
| 7 | Malformed `date` on the public read | 400 `date must be in YYYY-MM-DD format` | HTTP |
| 8 | Today's 7–8am read at 4pm | listed, `available: false`, `Orders for this slot have closed` | HTTP |
| 9 | Same window for tomorrow | `available: true` — today's cut-off does not leak | HTTP |
| 10 | A slot restricted to other weekdays | absent from that day's list | tests |
| 11 | Order with no slot | 201, `scheduledAt: null`, empty `deliverySlot` | HTTP |
| 12 | Order into tomorrow's 7–8am | 201, `scheduledAt` 07:00 local, window snapshotted | HTTP |
| 13 | Order into a closed window | 400 `Orders for this slot have closed` | HTTP |
| 14 | Third order into a 2-order window | 400 `This slot is full`; list reads `booked 2/2` | HTTP |
| 15 | Slot error precedes the zone check | closed-window order reported the window, not the address | HTTP |
| 16 | `PATCH` / `DELETE` with an unknown or malformed id | 404 `Slot not found` | HTTP |
| 17 | Cancelled order frees its place | `booked` drops back | tests |
| 18 | Retire a slot | row survives, leaves the active list, rejected for new bookings | tests |
| 19 | Subscription with `deliverySlotId` | stored window, `deliveryTime` set to `07:00` | browser |
| 20 | Subscription with `deliveryTime` only | accepted, no window recorded | tests |
| 21 | Subscription with neither | `Pick a delivery slot` | tests |
| 22 | Subscription to a retired slot | `That delivery slot is not available` | tests |
| 23 | Subscription ignores cut-off and capacity | accepted against a closed and a full window | tests |
| 24 | Order from a due occurrence | carried the subscribed window, timed to its start | dev script |
| 25 | Slot list and picker in the cart | closed and full windows greyed with their reason | browser |
| 26 | Order placed from the cart UI into a chosen window | `scheduledAt` matched the window on the chosen day | browser |
| 27 | Instant placed from the cart UI | `scheduledAt: null`, no window | browser |
| 28 | Three checkouts at once for a one-place window | one order placed, two `This slot is full` | dev script |
| 29 | Concurrent claims on a capped window | never more than the capacity let in | tests |
| 30 | Cancelled order's place | freed on the next read of that day | tests |
| 31 | 7–8 AM window on a shop opening at 09:00 | ordered through the cart UI and placed | browser |
| 32 | Window label on the seller's Scheduled tab | `12 Sept, 07:00 am · Morning 7-8 AM · 07:00–08:00` | browser |
| 33 | Order naming a slot later deleted outright | still read its window correctly | browser |
| 34 | Window outside every shop's hours | flagged on the admin screen, still orderable | browser |
| 35 | Window inside opening hours | no warning | browser |
| 36 | Shop with no hours on record | counted as keeping standard 09:00–22:00 hours | tests |
| 37 | Claiming a place in an uncapped window | nothing recorded — nothing contends over it | tests |
| 38 | Booking a window on a shop that has paused orders | 400 `Store is currently offline.` | dev script |
| 39 | Same, on the cart screen | pay button reads `Offline` with a window selected | browser |
| 40 | Booking a window outside the shop's hours, shop switched on | accepted | browser |
| 41 | Booking on a shop that does not auto-accept | `acceptanceDeadlineAt` = window start, not now + 4 min | dev script |
| 42 | Instant order beside it | `acceptanceDeadlineAt` = now + 4 min, unchanged | dev script |
| 43 | Acceptance sweep run against both | neither cancelled; the booking survives the night | dev script |
| 44 | Booking unaccepted past its window | cancelled `cancelled_by_restaurant` | tests |
| 45 | Waking a booking already delivered, dispatched, or gone | no rider hunt started | tests |
| 46 | Cancelling a confirmed booking for tomorrow | cancelled, and its place freed | dev script |
| 47 | Cancelling a confirmed instant order beside it | still `Order cannot be cancelled` | dev script |
| 48 | Cancelling a booking a rider is already on | refused | tests |
| 49 | Cancelling a booking whose window has opened | refused | tests |
| 50 | Tracking text and countdown for a booking | `Arriving Tomorrow, 07:00–08:00`, 849 min to the window | browser |
| 51 | Same for an instant order beside it | `Order confirmed`, 34 min — unchanged | browser |
| 52 | Rider-facing clocks on a booking | all start at dispatch, which is deferred to the window | code read |
| 53 | Refund on a cancelled booking | full amount, no elapsed-time fee | code read |
| 54 | Tracking screen, orders list and dock | one shared countdown, no longer three copies | browser |
| 55 | A window already past | treated as an ordinary order again | browser |
| 56 | Acceptance push on a booking | names the window, not "starting to prepare it" | code read |
| 57 | Stock held by a booking | not reclaimed by any age-based sweep | code read |
| 58 | Full regression: book, place instant, cancel each | booking cancelled, instant refused, place freed | dev script |
| 59 | **A booking that survived a real overnight** | placed 11 Sep for 12 Sep 07:00 — still `confirmed` next day, not swept | browser |
| 60 | Today's windows once both are unusable | both listed, one "closed", one "full", plus "try another day" | browser |
| 61 | Booking placed through the cart UI, then read back | `scheduledAt` 13 Sep 07:00, window snapshotted | browser |
| 62 | Home dock on that booking | `Arriving Tomorrow, 07:00–08:00` · `BOOKED 07:00 am` | browser |
| 63 | Orders list row for a booking | names the window; no minute countdown | browser |
| 64 | Orders list row for an instant order beside it | `28 mins remaining`, unchanged | browser |
| 65 | Seller Scheduled tab | `13 Sept, 06:00 pm · Evening 6-8 PM · 18:00–20:00` | browser |

Backend suite at the time of writing: **201 tests, all passing**
(`Backend/tests/deliverySlots.test.js`, `Backend/tests/productSubscriptionAdmin.test.js`).

### Known limits

- **Nothing has run under real traffic.** The concurrency guarantee is proven with three
  simultaneous checkouts, not three hundred.
- **A booking has now survived a real overnight** (check 59): orders placed on 11 Sep for
  the 07:00 window on 12 Sep were still `confirmed` the next day. What remains unproven
  is the *deferred dispatch* firing from its queued job after a long wait — the handler
  and the queuing are verified, an actual 18-hour timer completing is not.
- **Slots are platform-wide**, not per seller — one set of windows for every shop. This
  was a deliberate decision, not an oversight.
