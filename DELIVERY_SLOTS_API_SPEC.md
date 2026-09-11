# Delivery Slots — API spec

For the Flutter developer. Everything here was exercised against a running backend;
section 8 lists what was checked and what came back.

**Base URL:** `{host}/api/v1`

---

## 1. What a slot is

A delivery slot is a window the customer books a delivery into — "Morning 7–8 AM" —
instead of taking it as soon as the shop can send it.

**Instant is not a slot.** An order placed with no slot goes out immediately, on the
path it always took. Nothing about instant ordering changed when slots were added, and
an app that never sends a slot keeps working exactly as it does today.

So the choice on screen is:

```
( ) Instant        — we start packing straight away
( ) Pick a slot    — choose the window you want it delivered in
```

with the window list appearing only under the second. Do **not** put "Instant" inside
the slot list as if it were a window; it is a separate choice above it.

Slots are configured by the admin (Admin → Settings → Delivery Slots). A shop that has
configured none returns an empty list — in that case hide the "Pick a slot" option
entirely rather than showing an empty picker.

---

## 2. Read the windows on offer

`GET /food/restaurant/delivery-slots?date=YYYY-MM-DD` → **200**

**No auth.** Whether the shop delivers at 7am is part of deciding whether to order at
all, so this is readable before signing in.

| Query | Required | Notes |
|---|---|---|
| `date` | — | `YYYY-MM-DD`, read as a **local calendar day**, not a UTC instant. Omit for today |

```json
{
  "success": true,
  "message": "Available slots",
  "data": {
    "date": "2026-09-10T18:30:00.000Z",
    "slots": [
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
        "deliveryAt": "2026-09-11T01:30:00.000Z",
        "ordersClose": "2026-09-11T00:30:00.000Z",
        "booked": 1,
        "available": false,
        "reason": "Orders for this slot have closed"
      },
      {
        "id": "6aa3d66feb870c2dba07291c",
        "label": "Evening 6-8 PM",
        "startTime": "18:00",
        "endTime": "20:00",
        "cutoffMinutes": 60,
        "capacity": 2,
        "daysOfWeek": [],
        "isActive": true,
        "sortOrder": 0,
        "deliveryAt": "2026-09-11T12:30:00.000Z",
        "ordersClose": "2026-09-11T11:30:00.000Z",
        "booked": 0,
        "available": true,
        "reason": ""
      }
    ]
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | What you send back when booking |
| `label` | string | The customer-facing name. Show this, not the raw times alone |
| `startTime` / `endTime` | `"HH:mm"` | 24-hour, the shop's local time |
| `cutoffMinutes` | int | How long before `startTime` orders for the window stop |
| `capacity` | int \| `null` | Orders the window takes per day. `null` = uncapped |
| `daysOfWeek` | int[] | Empty = runs every day. Otherwise `0`=Sunday … `6`=Saturday |
| `deliveryAt` | ISO 8601 | When the delivery lands: the start of the window on that day |
| `ordersClose` | ISO 8601 | The moment ordering for it stops |
| `booked` | int | Orders already in it **for that day** |
| `available` | bool | Whether it can still be taken |
| `reason` | string | Why not, when `available` is `false`. Empty otherwise |

`isActive` and `sortOrder` are admin bookkeeping; the list is already sorted and only
active slots are returned, so you can ignore both.

### Show the unavailable ones

**Render every slot the endpoint returns, including the ones that cannot be taken.**

A slot that is closed or full comes back with `available: false` and a `reason` that is
meant to go on screen:

| `reason` | When |
|---|---|
| `"Orders for this slot have closed"` | Past the cut-off, for today only |
| `"This slot is full"` | `booked` has reached `capacity` for that day |

Grey it out, make it untappable, and put the reason under the times. A list that
silently omits the 7am window teaches the customer the shop does not deliver then; told
that orders for it closed, they come back tomorrow.

### The day matters

The cut-off applies to **today only**. The same window is open for tomorrow even when
today's has closed — at 11pm tonight, today's 7am slot is shut and tomorrow's is not.
Capacity is likewise counted per day: a window full tomorrow says nothing about the day
after.

Offer the next few days as chips (the web app offers four: today plus three) and
re-fetch on each change.

### Errors

| Status | `message` | Cause |
|---|---|---|
| 400 | `date must be in YYYY-MM-DD format` | Any other date format |

---

## 3. Book a slot on a one-off order

`POST /food/orders` — the existing create-order call, with two more fields.

| Field | Type | Notes |
|---|---|---|
| `deliverySlotId` | string | The `id` of the slot the customer picked |
| `deliveryDate` | string | `YYYY-MM-DD`, the day it is for |

**Send the slot id, not a timestamp.** The server derives the delivery time from the
window and re-checks that it is still open. The list on screen may be several minutes
old by the time payment goes through, and a window can close or fill in between — so a
booking is only confirmed at this point, never at the moment the customer taps it.

Omit both fields for an instant order.

### Do not gate a window on the shop's opening hours

A booked window is not measured against the shop's counter hours, on either
side — a 7–8 AM round exists precisely because the counter is shut at 7am, so
checking one against the other makes every early slot pickable but unorderable.
If your screen disables checkout while the shop reads as closed, **skip the
opening-hours part when a slot is selected**; keep it for instant orders, which
really do depend on the shop being open now.

Set aside the clock only — **not** the shop's own switch. A shop that has paused
orders (`isAcceptingOrders: false`) or been deactivated (`isActive: false`) is not
taking bookings for later either: closed for the day has to stop a 7am booking the
same way it stops one for right now. Booking into a window on a shop in that state
returns `Store is currently offline.` or `Store is currently closed.`

### What comes back

A slot-booked order:

```json
"scheduledAt": "2026-09-12T01:30:00.000Z",
"deliverySlot": {
  "slotId": "6aa3d665eb870c2dba072917",
  "label": "Morning 7-8 AM",
  "startTime": "07:00",
  "endTime": "08:00"
}
```

An instant order:

```json
"scheduledAt": null,
"deliverySlot": { "slotId": null, "label": "", "startTime": "", "endTime": "" }
```

Use `deliverySlot.slotId` — not the presence of the object — to tell them apart.

The window is a **snapshot**. Renaming or retiring the slot later does not rewrite what
a placed order says, so show `order.deliverySlot.label` on the tracking screen rather
than looking the slot up again.

### A booking is not acted on until its window

Two things that happen immediately for an ordinary order are deferred for a booking,
and the app should not expect them at checkout:

- **The seller's acceptance clock runs to the start of the window**, not to a few
  minutes from now. `acceptanceDeadlineAt` on a booking equals `scheduledAt`. Do not
  render a booking on a countdown card built for minutes — a 7am booking placed at
  midnight legitimately has seven hours on it. A booking still unaccepted when its
  window opens is cancelled as `cancelled_by_restaurant`, exactly as an ignored
  instant order is.
- **The rider hunt starts about half an hour before the window**, not at checkout, so
  `dispatch.status` stays `unassigned` for hours and that is correct. Do not show
  "looking for a rider" on a booking until its window is close.

### Errors

| Status | `message` | Cause |
|---|---|---|
| 400 | `Orders for this slot have closed` | Cut-off passed between listing and paying |
| 400 | `This slot is full` | Capacity reached between listing and paying |
| 400 | `That delivery slot is not available on the chosen day` | Slot does not run on that weekday, or was retired |
| 400 | `Invalid delivery slot` | `deliverySlotId` is not an id |

All four use the same wording as the list, so they can be shown to the customer as-is.
On any of them, re-fetch the day's slots and let them pick again — the list will now
show the window with its reason.

`This slot is full` is the one to expect on a busy window: the last place is decided
here, not when the customer tapped it, so two people paying at the same moment for the
same last place will see one order placed and one refusal. Treat it as a normal
outcome, not an error state.

These fire **before** the delivery-zone check, so a closed window reports the window
rather than "We don't deliver to this address yet".

---

## 4. Subscribe to a window

`POST /food/user/subscriptions` takes a slot instead of a typed time.

| Field | Type | Required | Notes |
|---|---|---|---|
| `deliverySlotId` | string | one of the two | Preferred. The app should show windows, not a clock |
| `deliveryTime` | `"HH:mm"` | one of the two | Still accepted, for shops with no slots configured |

Send one or the other. Sending neither is rejected with `Pick a delivery slot`.

When a slot is used, the subscription stores both: `deliveryTime` is set to the
window's `startTime`, so every existing screen that reads `deliveryTime` keeps working,
and `deliverySlot` carries the name and both ends:

```json
"deliveryTime": "07:00",
"deliverySlot": {
  "slotId": "6aa3d665eb870c2dba072917",
  "label": "Morning 7-8 AM",
  "startTime": "07:00",
  "endTime": "08:00"
}
```

Show `deliverySlot.label` when it is there, and fall back to `deliveryTime` when it is
not — older subscriptions have no window.

### A subscription is not judged against a day

Picking a window for a subscription ignores both the cut-off and capacity. A
subscription is not competing for tomorrow's 7am van; it is asking to be on every 7am
van. So `POST /food/user/subscriptions` with a 7am slot succeeds at 6:30pm, and
succeeds when tomorrow's 7am is already full.

Which means: **build the subscription picker from `GET /food/restaurant/delivery-slots`
but ignore `available` and `reason` there** — every returned window is selectable. Only
the one-off order flow greys them out.

Each occurrence, when it becomes a real order, carries the subscribed window and is
timed to its start on that day.

### Errors

| Status | `message` | Cause |
|---|---|---|
| 400 | `Pick a delivery slot` | Neither field sent |
| 400 | `That delivery slot is not available` | Slot retired or gone |
| 400 | `Invalid delivery slot` | `deliverySlotId` is not an id |

---

## 5. Admin endpoints

Bearer admin token. Permission section: `system_settings`. Only needed if the Flutter
build includes an admin console — the customer app uses section 2 only.

### List

`GET /food/admin/delivery-slots` → **200**

| Query | Notes |
|---|---|
| `includeInactive` | Defaults to **true**. Pass `false` to omit retired slots |
| `withCoverage` | `true` adds `coverage: { open, total }` per slot — how many approved shops keep hours covering the window, out of how many there are. Costs two extra queries, so only the slots screen asks for it |

`coverage.open === 0` means the window is one no shop is open for. Say so on the
screen — ordering into a window deliberately ignores counter hours, so nothing else
would tell the admin that the 3 AM window they just published cannot be served. Warn,
do not block: publishing it is their call.

```json
{ "success": true, "message": "Delivery slots", "data": { "slots": [ … ] } }
```

Same slot shape as section 2, minus the per-day fields (`deliveryAt`, `ordersClose`,
`booked`, `available`, `reason`) — those only exist in the context of a date.

### Create

`POST /food/admin/delivery-slots` → **201**

```json
{
  "label": "Morning 7-8 AM",
  "startTime": "07:00",
  "endTime": "08:00",
  "cutoffMinutes": 60,
  "capacity": null,
  "daysOfWeek": [],
  "sortOrder": 0
}
```

| Field | Required | Notes |
|---|---|---|
| `label` | ✅ | |
| `startTime`, `endTime` | ✅ | `"HH:mm"`. End must be after start |
| `cutoffMinutes` | — | Defaults to `60`. `0` means orders taken up to the start |
| `capacity` | — | `null` or omitted = uncapped. Must be ≥ 1 if given |
| `daysOfWeek` | — | Empty = every day |
| `sortOrder` | — | Display order; ties break on `startTime` |

Returns `data.slot`.

### Update

`PATCH /food/admin/delivery-slots/{slotId}` → **200**. Partial; send only what changes.

Both ends are validated together even when only one is sent, so a window cannot be
edited into ending before it starts one field at a time.

Passing `isActive: true` is how a retired slot is put back on offer.

### Retire

`DELETE /food/admin/delivery-slots/{slotId}` → **200**, message `Delivery slot retired`.

**This does not delete.** It sets `isActive: false`. Orders already booked into the
window still name it, and a deleted row would leave them pointing at nothing — the
customer's "arriving 7–8am" would go blank on an order that is still coming.

Keep retired slots visible in the admin list, greyed out, with a way to restore them.

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
| 404 | `Slot not found` — also returned for a malformed id |

---

## 6. Suggested flow in the app

**Cart**

1. Default to Instant. Send no slot fields — this is the unchanged path.
2. If the customer taps "Pick a slot", show day chips (today + 3) and call
   `GET /food/restaurant/delivery-slots?date=…` for the selected day.
3. Pre-select the first window with `available: true`. If none, keep the list visible
   with its reasons and say every window for the day is taken.
4. Re-select when the day changes, and drop any selection whose slot is no longer
   available in the new response.
5. On place-order, send `deliverySlotId` + `deliveryDate`; on a 400 from the four slot
   errors, re-fetch and let them choose again.

**Subscription**

1. Fetch the same list once (any date) and show every window as selectable.
2. Send `deliverySlotId`. Fall back to a time picker only when the list is empty.

**Order tracking**

Show `order.deliverySlot.label` when `slotId` is set, otherwise the usual ETA.

---

## 7. Timezone

`startTime`, `endTime` and `cutoffMinutes` are the shop's local wall-clock. `date` is a
local calendar day. `deliveryAt`, `ordersClose` and `scheduledAt` are absolute instants
in ISO 8601 — parse them, do not string-slice them. In the examples above the server is
on IST, which is why `07:00` local appears as `01:30Z`.

---

## 8. Verified against

Exercised against a running backend rather than read off the source. "HTTP" means the
call was made against the dev server and the response below is what came back; "tests"
means it is pinned by the backend suite; "browser" means it was done through the web
UI and the result read back out of the database.

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
| 14 | Third order into a 2-order window | 400 `This slot is full`; list then reads `booked 2/2` | HTTP |
| 15 | Slot error precedes the zone check | closed-window order reported the window, not the address | HTTP |
| 16 | `PATCH` / `DELETE` with an unknown or malformed id | 404 `Slot not found` | HTTP |
| 17 | Cancelled order frees its place | `booked` drops back | tests |
| 18 | Retire a slot | row survives, leaves the active list, rejected for new bookings | tests |
| 19 | Subscription with `deliverySlotId` | stored the window, `deliveryTime` set to `07:00` | browser |
| 20 | Subscription with `deliveryTime` only | accepted, no window recorded | tests |
| 21 | Subscription with neither | `Pick a delivery slot` | tests |
| 22 | Subscription to a retired slot | `That delivery slot is not available` | tests |
| 23 | Subscription ignores cut-off and capacity | accepted against a closed and a full window | tests |
| 24 | Order from a due occurrence | carried the subscribed window, timed to its start | dev script |
| 25 | Slot list and picker in the cart | closed and full windows shown greyed with their reason | browser |
| 26 | Order placed from the cart UI into a chosen window | `scheduledAt` matched the window on the chosen day | browser |
| 27 | Instant placed from the cart UI | `scheduledAt: null`, no window | browser |
| 28 | Three checkouts at once for a one-place window | one order placed, two `This slot is full` | dev script |
| 29 | Concurrent claims on a capped window | never more than the capacity let in | tests |
| 30 | Cancelled order's place | freed on the next read of that day | tests |
| 31 | 7–8 AM window on a shop opening at 09:00 | ordered through the cart UI and placed | browser |
| 32 | Window label on the seller's Scheduled tab | `12 Sept, 07:00 am · Morning 7-8 AM · 07:00–08:00` | browser |
| 33 | Order naming a slot that was later deleted outright | still read its window correctly | browser |
| 34 | Window outside every shop's hours | flagged on the admin screen, still orderable | browser |
| 35 | Window inside opening hours | no warning | browser |
| 36 | Shop with no hours on record | counted as keeping standard 09:00–22:00 hours | tests |
| 37 | Claiming a place in an uncapped window | nothing recorded — nothing contends over it | tests |
| 38 | Booking a window on a shop that has paused orders | 400 `Store is currently offline.` | dev script |
| 39 | Same, on the cart screen | pay button reads `Offline` with a window selected | browser |
| 40 | Booking a window outside the shop's hours, shop switched on | accepted | browser |
| 41 | Booking on a shop that does not auto-accept | `acceptanceDeadlineAt` = the window start, not now + 4 min | dev script |
| 42 | Instant order beside it | `acceptanceDeadlineAt` = now + 4 min, unchanged | dev script |
| 43 | Acceptance sweep run against both | neither cancelled; the booking survives the night | dev script |
| 44 | Booking unaccepted past its window | cancelled `cancelled_by_restaurant` | tests |
| 45 | Waking a booking already delivered, dispatched, or gone | no rider hunt started | tests |

Backend suite at the time of writing: 197 tests, all passing
(`Backend/tests/deliverySlots.test.js`, `Backend/tests/productSubscriptionAdmin.test.js`).
