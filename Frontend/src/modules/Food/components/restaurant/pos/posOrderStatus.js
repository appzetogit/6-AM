/**
 * The order-status tabs, and what each one actually asks the server for.
 *
 * The labels are the admin panel's, so one order means the same word wherever
 * it is looked at. The queries are this system's real `orderStatus` values —
 * `listOrdersRestaurant` takes a comma-separated list, or `scheduled=true`
 * for the ones booked for later.
 *
 * Written out rather than derived because the mapping is the whole point: a
 * tab that sends a status string this system does not use returns an empty
 * list and looks like an empty day.
 */
export const POS_ORDER_TABS = [
  { key: "all", label: "All", params: {} },
  { key: "scheduled", label: "Scheduled", params: { scheduled: "true" } },
  { key: "new", label: "New Requests", params: { orderStatus: "created" } },
  {
    key: "processing",
    label: "Processing",
    params: { orderStatus: "confirmed,preparing,ready_for_pickup" },
  },
  {
    key: "on-the-way",
    label: "On The Way",
    params: { orderStatus: "reached_pickup,picked_up,reached_drop" },
  },
  { key: "delivered", label: "Delivered", params: { orderStatus: "delivered" } },
  {
    key: "cancelled",
    label: "Cancelled",
    params: { orderStatus: "cancelled_by_user,cancelled_by_restaurant,cancelled_by_admin" },
  },
  {
    key: "abandoned",
    label: "Abandoned",
    params: { orderStatus: "pending_payment" },
    /**
     * This one can only ever come back empty, and says so rather than looking
     * like a quiet day: listOrdersRestaurant returns orders that were paid for
     * or are collect-on-delivery, and an abandoned order is neither. A seller
     * is not shown checkouts nobody completed.
     */
    emptyNote: "A seller is not shown checkouts the customer never paid for, so this list stays empty.",
  },
]

export const POS_ORDER_TAB = Object.fromEntries(POS_ORDER_TABS.map((t) => [t.key, t]))

/** Display label for whatever the server sent back on a row. */
export const ORDER_STATUS_LABEL = {
  pending_payment: "Awaiting payment",
  created: "New request",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready_for_pickup: "Ready",
  reached_pickup: "Rider at store",
  picked_up: "Picked up",
  reached_drop: "At the door",
  delivered: "Delivered",
  cancelled_by_user: "Cancelled by customer",
  cancelled_by_restaurant: "Cancelled by store",
  cancelled_by_admin: "Cancelled by admin",
}

export const statusTone = (status) => {
  const s = String(status || "").toLowerCase()
  if (s === "delivered") return "bg-emerald-50 text-emerald-700 ring-emerald-200"
  if (s.startsWith("cancelled")) return "bg-rose-50 text-rose-700 ring-rose-200"
  if (s === "created" || s === "pending_payment") return "bg-amber-50 text-amber-700 ring-amber-200"
  return "bg-sky-50 text-sky-700 ring-sky-200"
}
