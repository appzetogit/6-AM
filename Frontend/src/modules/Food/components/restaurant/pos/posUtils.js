/**
 * Shared bits for the till: money formatting, the order-type and key maps,
 * line arithmetic, and the printable receipt.
 *
 * Line arithmetic here is only what the screen shows while the cashier is
 * typing; the amount actually charged comes back from the server's quote,
 * which is the same engine that will write the order.
 */

export const ORDER_TYPES = [
  { value: "dine_in", label: "Dine In" },
  { value: "take_away", label: "Take Away" },
  { value: "walk_in", label: "Walk In" },
  { value: "delivery", label: "Delivery" },
]

export const ORDER_TYPE_LABEL = Object.fromEntries(ORDER_TYPES.map((t) => [t.value, t.label]))

export const TENDER_LABEL = { cash: "Cash", upi: "UPI", card: "Card", multiple: "Multiple", pay_later: "Pay Later" }

/** F-keys, exactly as printed on the buttons. */
export const KEY_ACTIONS = {
  F3: { mode: "card" },
  F4: { mode: "cash" },
  F5: { mode: "upi" },
  F6: { hold: true },
  F7: { hold: true, print: true },
  F8: { mode: "cash", print: true },
  F9: { mode: "card", print: true },
  F10: { mode: "upi", print: true },
  F11: { mode: "pay_later" },
  F12: { mode: "multiple" },
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export const money = (n, digits = 1) => {
  const v = Number(n) || 0
  return v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) })
}

export const fmtDateTime = (d) => {
  if (!d) return "-"
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export const fmtDate = (d) => {
  if (!d) return "-"
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

/** The rupee discount on one line: a percentage of the gross plus a flat amount. */
export const lineDiscount = (line) => {
  const gross = (Number(line.price) || 0) * (Number(line.quantity) || 0)
  const pct = Math.min(100, Math.max(0, Number(line.discountPct) || 0))
  const add = Math.max(0, Number(line.addDisc) || 0)
  return round2(Math.min(gross, (gross * pct) / 100 + add))
}

export const lineNet = (line) =>
  round2((Number(line.price) || 0) * (Number(line.quantity) || 0) - lineDiscount(line))

/** What the strip shows before, or without, a server quote. */
export const localTotals = (lines) =>
  lines.reduce(
    (acc, line) => {
      const qty = Number(line.quantity) || 0
      acc.quantity += qty
      acc.mrp += (Number(line.mrp) || Number(line.price) || 0) * qty
      acc.gross += (Number(line.price) || 0) * qty
      acc.lineDiscount += lineDiscount(line)
      return acc
    },
    { quantity: 0, mrp: 0, gross: 0, lineDiscount: 0 },
  )

/** A cart line from a menu item. Codes are what a scanner types, so they are kept. */
export const lineFromItem = (item) => ({
  key: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  itemId: String(item.id),
  name: item.name,
  itemCode: item.itemCode || item.sku || item.barcode || "",
  barcode: item.barcode || "",
  price: Number(item.price) || 0,
  mrp: item.mrp != null ? Number(item.mrp) : null,
  unit: item.packSize || item.unit || "",
  gstRate: item.gstRate ?? null,
  stockQty: item.stockQty ?? null,
  quantity: 1,
  discountPct: 0,
  addDisc: 0,
})

/** Does a typed or scanned string name this item exactly? Codes first, then the name. */
export const matchesCode = (item, code) => {
  const c = String(code || "").trim().toLowerCase()
  if (!c) return false
  return [item.barcode, item.sku, item.itemCode].some((v) => v && String(v).trim().toLowerCase() === c)
}

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch])

/**
 * An 80mm receipt. Opened in its own window and printed from there, the same
 * way the customer-side invoice does it, so the till's own layout never has
 * to carry print CSS.
 */
export const receiptHtml = (r, { title = "Bill", held = false } = {}) => {
  const store = r.store || {}
  const rows = (r.items || [])
    .map(
      (it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(it.name)}${it.variantName ? ` <small>(${escapeHtml(it.variantName)})</small>` : ""}</td>
        <td class="r">${it.quantity}</td>
        <td class="r">${money(it.price, 2)}</td>
        <td class="r">${it.discount ? money(it.discount, 2) : "-"}</td>
        <td class="r">${money(it.amount, 2)}</td>
      </tr>`,
    )
    .join("")
  const p = r.pricing || {}
  const pay = r.payment || {}
  const tenders = (pay.tenders || []).map((t) => `${TENDER_LABEL[t.mode] || t.mode} ₹${money(t.amount, 2)}`).join(", ")

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(r.billNo || "")}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 12px/1.35 "Courier New", monospace; color: #000; margin: 0; padding: 8px; width: 80mm; }
  h1 { font-size: 15px; margin: 0; text-align: center; }
  .c { text-align: center; } .r { text-align: right; }
  .muted { color: #333; font-size: 11px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 2px 0; vertical-align: top; }
  th { text-align: left; border-bottom: 1px solid #000; font-size: 11px; }
  .tot td { padding: 1px 0; }
  .grand td { font-weight: bold; font-size: 14px; border-top: 1px solid #000; padding-top: 4px; }
  .badge { display: inline-block; border: 1px solid #000; padding: 0 4px; font-size: 11px; }
  @media print { body { width: auto; } }
</style></head><body>
  <h1>${escapeHtml(store.name || "")}</h1>
  ${store.address ? `<div class="c muted">${escapeHtml(store.address)}</div>` : ""}
  ${store.phone ? `<div class="c muted">Ph: ${escapeHtml(store.phone)}</div>` : ""}
  ${store.gstNumber ? `<div class="c muted">GSTIN: ${escapeHtml(store.gstNumber)}</div>` : ""}
  ${store.fssaiNumber ? `<div class="c muted">FSSAI: ${escapeHtml(store.fssaiNumber)}</div>` : ""}
  <hr>
  <div class="c"><span class="badge">${held ? "HELD BILL — NOT A TAX INVOICE" : escapeHtml(title.toUpperCase())}</span></div>
  <table class="muted" style="margin-top:4px">
    <tr><td>Bill No</td><td class="r"><b>${escapeHtml(r.billNo || "-")}</b></td></tr>
    <tr><td>Date</td><td class="r">${escapeHtml(fmtDateTime(r.createdAt || new Date()))}</td></tr>
    <tr><td>Type</td><td class="r">${escapeHtml(r.orderTypeLabel || ORDER_TYPE_LABEL[r.orderType] || "")}${r.tableNo ? ` · Table ${escapeHtml(r.tableNo)}` : ""}</td></tr>
    ${r.salesman ? `<tr><td>Salesman</td><td class="r">${escapeHtml(r.salesman)}</td></tr>` : ""}
    <tr><td>Customer</td><td class="r">${escapeHtml(r.customer?.name || "Walk in Customer")}${r.customer?.phone ? ` · ${escapeHtml(r.customer.phone)}` : ""}</td></tr>
  </table>
  <hr>
  <table>
    <thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc</th><th class="r">Amt</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr>
  <table class="tot">
    <tr><td>Sub Total</td><td class="r">${money(p.subtotal, 2)}</td></tr>
    ${p.discount ? `<tr><td>Discount${p.couponCode ? ` (${escapeHtml(p.couponCode)})` : ""}</td><td class="r">-${money(p.discount, 2)}</td></tr>` : ""}
    ${p.tax ? `<tr><td>GST</td><td class="r">${money(p.tax, 2)}</td></tr>` : ""}
    ${p.additionalCharges ? `<tr><td>Add. Charges</td><td class="r">${money(p.additionalCharges, 2)}</td></tr>` : ""}
    ${p.roundOff ? `<tr><td>Round Off</td><td class="r">${p.roundOff > 0 ? "+" : ""}${money(p.roundOff, 2)}</td></tr>` : ""}
    <tr class="grand"><td>TOTAL</td><td class="r">₹${money(p.total, 2)}</td></tr>
    ${held ? "" : `<tr><td>Paid by</td><td class="r">${escapeHtml(tenders || TENDER_LABEL[pay.mode] || pay.mode || "-")}</td></tr>`}
    ${pay.dueAmount ? `<tr><td><b>Balance Due</b></td><td class="r"><b>₹${money(pay.dueAmount, 2)}</b></td></tr>` : ""}
  </table>
  ${r.remarks ? `<hr><div class="muted">Remarks: ${escapeHtml(r.remarks)}</div>` : ""}
  <hr>
  <div class="c muted">Thank you, visit again</div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`
}

export const printReceipt = (receipt, opts) => {
  if (!receipt) return false
  const w = window.open("", "_blank", "width=420,height=640")
  if (!w) return false
  w.document.open()
  w.document.write(receiptHtml(receipt, opts))
  w.document.close()
  return true
}
