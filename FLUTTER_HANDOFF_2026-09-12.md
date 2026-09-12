# Flutter handoff — 12 Sep 2026

What changed across the three apps, why, and what each one has to do about it.

This is a **delta**, not a replacement. The full contracts stay where they are:

| App | Spec |
|---|---|
| Customer | [FLUTTER_API_SPEC.md](FLUTTER_API_SPEC.md) |
| Rider | [DELIVERY_API_SPEC.md](DELIVERY_API_SPEC.md) |
| Seller | [RESTAURANT_API_SPEC.md](RESTAURANT_API_SPEC.md) |
| Delivery windows | [DELIVERY_SLOTS_API_SPEC.md](DELIVERY_SLOTS_API_SPEC.md) |
| Quick-commerce conversion | [QUICK_COMMERCE_CHANGES.md](QUICK_COMMERCE_CHANGES.md) |

---

## 0. The one thing to internalise

**This is quick commerce.** The promise is packing plus two short rides — minutes,
not half an hour. Every timing below is *derived* from that promise rather than
picked, and they move together if the business changes.

| Number | Value | Derived from | Env override |
|---|---|---|---|
| Packing | 3 min | — | `PACKING_MINUTES` |
| Dispatch radius bands | 3 / 5 / 8 / 12 km | — | `DISPATCH_RADIUS_BANDS_KM` |
| Rider offer radius | 15 km | ¼ wider than the furthest band | follows the bands |
| Dispatch lead | 11 min | packing vs. the ride across the first band, plus hunt slack | `DISPATCH_LEAD_MINUTES` |
| Slot cut-off default | 15 min | dispatch lead + one packing slot | `SLOT_CUTOFF_MINUTES` |

If a screen quotes a half-hour wait on this product, it is reading a
restaurant-era constant. Quote `pricing.deliveryPromiseMinutes`, and quote the
**same number everywhere on the screen** — the web cart had a header saying
"35-40 mins" directly above an option saying "about 6 mins".

---

## 1. Customer app

### 1.1 The cart has no delivery-window picker

A basket is for **now**. The morning 7–8 round is a *standing arrangement* you
subscribe to, not something chosen per basket. The web cart's window picker has
been removed; the Flutter cart should not have one.

Send no `deliverySlotId` / `deliveryDate` from the cart. The order-side slot
fields still exist and still work — subscription occurrences use them — but no
customer-facing cart should call them today.

Windows are chosen in exactly one place: **setting up a subscription**
(DELIVERY_SLOTS_API_SPEC §7).

### 1.2 Quote the real promise

`pricing.deliveryPromiseMinutes` comes back from the price-calculation endpoint,
so the wait can be shown before the customer commits. Use it for the header, the
delivery option, and anywhere else a wait appears. Fall back to the shop's
advertised band only until the quote lands.

### 1.3 A booking is a live order that is not in progress

For any order with a future `scheduledAt` (these come from subscriptions now):

- Count down to `scheduledAt`, **not** `createdAt + ETA`. Otherwise it reads as
  arriving in minutes and then as permanently overdue.
- Say *"Arriving Tomorrow, 07:00–08:00"*, not "Preparing your order".
- Do not render hundreds of minutes as a minute count — show the window.
- `dispatch.status` stays `unassigned` for hours. That is correct; do not show
  "looking for a rider" until the window is close.

Full rules and Dart snippets: DELIVERY_SLOTS_API_SPEC §6.

---

## 2. Rider app

### 2.1 A rider is now requested the moment the customer orders

Previously the hunt waited for the seller to tap Accept (unless the seller was on
auto-accept), so most orders sat idle for as long as the seller took to look up.
Picking and the ride to the store happen at the same time, so they now run in
parallel.

**Concretely: orders with `orderStatus: "created"` are offered.** `created` means
the seller has not answered yet. It is still a real, paid order with a real
address.

Two are never dispatched:
- **counter sales** — already in the customer's hands
- **`pending_payment`** — not paid for. Money first, always.

Both `GET /food/delivery/orders/available` and the socket offers include
`created` now; they are kept in step deliberately, because an offer arriving for
an order the rider cannot find in their list is worse than either alone.

### 2.2 New socket event: `order_assigned`

| Event | Meaning |
|---|---|
| `new_order` / `new_order_available` | The dispatcher is offering this to every eligible rider — a race |
| `order_assigned` | **A seller handed this order to you specifically** |

The rider still has to accept, so it can go through the same queue and the same
card. It is a separate event because "assigned to you" and "up for grabs" are
different things, and a later screen may want to say so.

### 2.3 The order payload gained the delivery window

`scheduledAt` and `deliverySlot` are now in the rider's order payload. Both are
`null` on an instant order. When present, the pickup card can say which round it
is rather than presenting a booked delivery as an ordinary one.

### 2.4 A booking is not offered until its window is close

Orders whose `scheduledAt` is further out than the dispatch lead (~11 min) are
excluded server-side. This matters more than it looks: accepting an order sets
`dispatch.status: accepted`, which **blocks the rider from further offers** — so
an order due tomorrow would have taken a rider off the road for a day.

No client-side filtering needed, but do not build a screen that assumes every
confirmed order in the area is available now.

### 2.5 Trip lifecycle (unchanged, confirmed end to end)

```
accept → reached-pickup → confirm-pickup → reached-drop → verify-drop-otp → complete
```

| Stage | Rider sees | Order becomes |
|---|---|---|
| accept | `en_route_to_pickup` | dispatch `accepted` |
| reached-pickup | `at_pickup` | — |
| **bill photo** | `CAPTURE BILL TO UNLOCK PICKUP` | gate is app-side |
| confirm-pickup | `en_route_to_delivery` | `picked_up` |
| reached-drop | `at_drop` | — |
| verify-drop-otp | `Verified ✓` | — |
| complete | `delivered` | `delivered` |

The bill photo is enforced by the **app**, not the backend — `confirm-pickup`
succeeds without one. It is also what unlocks the customer's phone number on the
seller's screen, so keep the gate.

The drop OTP is a 4-digit code the customer reads out; it is on the order as
`deliveryOtp`.

---

## 3. Seller app

### 3.1 Own fleet: link riders and hand them orders

| Method | Path |
|---|---|
| GET | `/food/restaurant/delivery-fleet` |
| POST | `/food/restaurant/delivery-fleet/link` — body `{ phone }` |
| DELETE | `/food/restaurant/delivery-fleet/:deliveryPartnerId` |
| POST | `/food/restaurant/orders/:orderId/assign-delivery` — body `{ deliveryPartnerId }` |

The fleet list returns each rider with `activeOrderCount`, so the picker can put
free riders first. The rider must already be **registered and approved** on the
platform — there is no invite flow, so a seller with a brand-new rider is blocked
until an admin approves them.

### 3.2 ⚠️ A seller with their own fleet gets NO automatic dispatch

This is the sharpest edge in this handoff. The moment a seller has one linked
rider, `tryAutoAssign` skips that seller entirely:

```
tryAutoAssign: Skip for <order> (restaurant <id> uses manual-only dispatch).
```

Fleet and automatic dispatch are **mutually exclusive per seller**. A seller who
links a rider and then waits for orders to dispatch themselves will wait forever.
If the seller app offers fleet management, it must say this plainly on that
screen.

### 3.3 Resend vs Assign

- **Resend** re-offers the order to the *platform's* riders.
- **Assign** hands it to one of the *seller's own*.

Both are available on an unassigned order. Resend now works on `created` orders
too — it previously refused them, which broke it for exactly the orders that
needed it once dispatch moved to order time.

### 3.4 Delivery windows on seller surfaces

Scheduled orders and subscriptions carry `deliverySlot`. Show the label, not the
raw time — *"Evening 6-8 PM · 18:00–20:00"*, not *"18:00"*.

---

## 4. Earnings

### 4.1 How the number is produced

`riderEarning` is computed **when the order is created** and stored on the order.
It comes from the admin's delivery fee ranges (Admin → Delivery & Platform Fee):
per band, either a flat `deliveryBoyBasePay` or `deliveryBoyPerKm` (base pay
wins if both are set).

**If no fee ranges are configured, every rider earning is ₹0.** That is not a
bug — it is what an unconfigured system returns, and it was the explanation for
every ₹0.00 seen while testing before the fees were set. With a 0–5 km band at
₹25 base pay the same order carried `riderEarning: 25` and paid out in full (§5).

Consider hiding the amount rather than printing **₹0.00** when it is zero — a
rider reads ₹0.00 as an unpaid job and declines.

### 4.2 There is no rider wallet balance

Earnings are **derived by aggregation** — `$sum: riderEarning` over the rider's
delivered orders — not stored as a running balance. `food_delivery_wallets` exists
for **cash-in-hand and withdrawals**, and no row is created just because a
delivery completed.

Measured after the run in §5, on a rider with seven completed deliveries:

```
delivered orders:        7
sum of riderEarning:     25      ← the six earlier ones predate the fee config
Pocket balance on screen: ₹25.00
wallet row:              none
```

So "no wallet row" is by design, and "Pocket balance" is a **computed figure, not
a stored one**. Do not build the Pocket screen expecting a balance field to
increment on delivery — there is no such field.

---

## 5. What was verified

**Driven end to end in a browser:** customer picks a product → cart → pays →
rider request arrives (socket, with a 15s expiry) → accept → reached pickup →
bill photo → pickup → reached drop → OTP → delivered. Twice, once as an instant
order and once as a booking. Seller fleet link + assign + the assigned order
running the same lifecycle. Admin fee configuration flowing into order pricing
and onto the rider's card.

**Backend suite:** 209 tests passing.

**The earning chain, proven end to end** on a single order after configuring the
fees — Pocket read ₹0 before the run, so the figure is attributable to it:

| Link | Observed |
|---|---|
| Admin fee config | 0–5 km band, ₹25 base pay |
| → order pricing | delivery fee and platform fee charged |
| → `riderEarning` on the order | `25` |
| → rider's offer card | **₹25.00** · TRIP TIME 3 MINS · 900 m |
| → trip | accept → pickup → drop → OTP → complete |
| → completion screen | **EARNINGS ADDED ₹25.00** |
| → **Pocket** | **EARNINGS 6–12 SEP: ₹25** · Pocket balance **₹25.00** |

---

## 6. Open decisions

These are product calls, not defects — flagging so they are chosen rather than
discovered:

1. **A `created` order can be auto-cancelled while a rider is riding to it.** The
   seller acceptance sweep still runs on its own clock; if the seller never
   accepts, the order goes `cancelled_by_restaurant` even though a rider may be
   en route. Observed twice in testing. Options: hold the seller's clock until a
   rider accepts, lengthen it, or accept the occasional wasted trip.
2. **Fleet vs automatic dispatch** (§3.2) — currently all-or-nothing per seller.
3. **₹0.00 on the offer card** (§4.1) when fees are unconfigured.
4. **Slot cut-offs** default to 15 min but are per-window; an early round may want
   a longer picking lead.
