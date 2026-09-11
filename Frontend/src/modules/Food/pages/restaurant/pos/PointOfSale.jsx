import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { restaurantAPI } from "@food/api"
import { getMenuFromResponse, flattenMenuItems } from "@food/utils/menuItems"
import usePosCart from "@food/components/restaurant/pos/usePosCart"
import PosTopBar from "@food/components/restaurant/pos/PosTopBar"
import PosProductSearch from "@food/components/restaurant/pos/PosProductSearch"
import PosCustomerBox from "@food/components/restaurant/pos/PosCustomerBox"
import PosCartTable from "@food/components/restaurant/pos/PosCartTable"
import PosTotalsStrip from "@food/components/restaurant/pos/PosTotalsStrip"
import PosPayButtons from "@food/components/restaurant/pos/PosPayButtons"
import PosRightRail from "@food/components/restaurant/pos/PosRightRail"
import PosHoldBillsModal from "@food/components/restaurant/pos/PosHoldBillsModal"
import PosOrdersModal from "@food/components/restaurant/pos/PosOrdersModal"
import PosPayScreen from "@food/components/restaurant/pos/PosPayScreen"
import PosCouponModal from "@food/components/restaurant/pos/PosCouponModal"
import PosCardDetailsModal from "@food/components/restaurant/pos/PosCardDetailsModal"
import { PosChargesModal, PosTableModal } from "@food/components/restaurant/pos/PosSmallModals"
import { KEY_ACTIONS, lineDiscount, printReceipt, ORDER_TYPE_LABEL } from "@food/components/restaurant/pos/posUtils"

const extractRestaurant = (response) =>
  response?.data?.data?.restaurant || response?.data?.restaurant || response?.data?.data || null

const errMsg = (err, fallback) => err?.response?.data?.message || err?.message || fallback

/**
 * The seller's till.
 *
 * The screen keeps the cart and what the cashier typed; every figure that
 * ends up on the receipt comes from the server — the quote while the bill is
 * open, the saved order once it is paid — so the strip, the receipt and the
 * ledger can never disagree.
 */
export default function PointOfSale() {
  const cart = usePosCart()
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(true)
  const [restaurant, setRestaurant] = useState(null)

  const [orderType, setOrderType] = useState("walk_in")
  const [tableNo, setTableNo] = useState("")
  const [salesmanChoice, setSalesman] = useState("")
  const [autoPrint, setAutoPrint] = useState(() => {
    try { return localStorage.getItem("pos.autoPrint") === "1" } catch { return false }
  })

  const [customer, setCustomer] = useState(null)
  const [summary, setSummary] = useState(null)
  const [remarks, setRemarks] = useState("")
  const [flat, setFlat] = useState({ type: "percent", value: 0 })
  const [additionalCharges, setAdditionalCharges] = useState(0)
  const [roundOff, setRoundOff] = useState(false)
  const [couponCode, setCouponCode] = useState("")

  const [quote, setQuote] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [lastBill, setLastBill] = useState(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null) // holds | orders | payments | multiple | coupon | charges | table | card
  // Whether the card payment being collected came from Card & Print (F9)
  // rather than Card (F3) — the dialog is the same either way.
  const [cardWillPrint, setCardWillPrint] = useState(false)
  const [invoiceRef, setInvoiceRef] = useState("")

  // The shop's own account, named on a card tender so a settlement query knows
  // which bank the money landed in.
  const bankAccounts = useMemo(() => {
    if (!restaurant?.accountNumber) return []
    const holder = restaurant.accountHolderName || restaurant.restaurantName || "Account"
    const tail = String(restaurant.accountNumber).slice(-4)
    return [`${holder} · ••••${tail}${restaurant.ifscCode ? ` · ${restaurant.ifscCode}` : ""}`]
  }, [restaurant])

  const salesmen = useMemo(() => {
    const names = [restaurant?.ownerName, restaurant?.restaurantName].map((s) => String(s || "").trim()).filter(Boolean)
    return names.length ? [...new Set(names)] : ["Counter"]
  }, [restaurant])
  // Until the cashier picks one, the owner is the salesman — derived, not
  // synced, so there is no render with an empty select.
  const salesman = salesmanChoice || salesmen[0]

  // ── loading ──────────────────────────────────────────────────────────

  const loadMenu = useCallback(async () => {
    setMenuLoading(true)
    try {
      const res = await restaurantAPI.getMenu()
      setMenuItems(flattenMenuItems(getMenuFromResponse(res)))
    } catch (err) {
      toast.error(errMsg(err, "Could not load products"))
    } finally {
      setMenuLoading(false)
    }
  }, [])

  const loadLastBill = useCallback(async () => {
    try {
      const res = await restaurantAPI.posLastBill()
      setLastBill(res?.data?.data || null)
    } catch {
      setLastBill(null)
    }
  }, [])

  useEffect(() => {
    loadMenu()
    loadLastBill()
    restaurantAPI.getCurrentRestaurant().then((res) => setRestaurant(extractRestaurant(res))).catch(() => {})
  }, [loadMenu, loadLastBill])

  useEffect(() => {
    try { localStorage.setItem("pos.autoPrint", autoPrint ? "1" : "0") } catch { /* private mode */ }
  }, [autoPrint])

  // The customer panel: their history with this shop, refreshed after each sale.
  const loadSummary = useCallback(async (id) => {
    if (!id) { setSummary(null); return }
    try {
      const res = await restaurantAPI.posCustomerSummary(id)
      setSummary(res?.data?.data || null)
    } catch {
      setSummary(null)
    }
  }, [])

  useEffect(() => { loadSummary(customer?.id) }, [customer?.id, loadSummary])

  // ── the quote ────────────────────────────────────────────────────────

  const billInput = useCallback(() => ({
    orderType,
    tableNo,
    salesman,
    remarks,
    customerId: customer?.id || undefined,
    customerName: customer?.name || undefined,
    customerPhone: customer?.phone || undefined,
    items: cart.lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) || 1, discount: lineDiscount(l) })),
    flatDiscount: flat,
    additionalCharges,
    roundOff,
    couponCode: couponCode || undefined,
  }), [orderType, tableNo, salesman, remarks, customer, cart.lines, flat, additionalCharges, roundOff, couponCode])

  // Just the lines, memoised: the coupon list refetches when the cart changes,
  // and a fresh array every render would make that an endless loop.
  const couponItems = useMemo(
    () => cart.lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) || 1 })),
    [cart.lines],
  )

  const quoteTimer = useRef(null)
  useEffect(() => {
    clearTimeout(quoteTimer.current)
    if (cart.lines.length === 0) { setQuote(null); setQuoting(false); return undefined }
    setQuoting(true)
    quoteTimer.current = setTimeout(async () => {
      try {
        const res = await restaurantAPI.posQuote(billInput())
        setQuote(res?.data?.data || null)
      } catch (err) {
        setQuote(null)
        toast.error(errMsg(err, "Could not price the bill"), { id: "pos-quote" })
      } finally {
        setQuoting(false)
      }
    }, 300)
    return () => clearTimeout(quoteTimer.current)
  }, [billInput, cart.lines.length])

  // ── actions ──────────────────────────────────────────────────────────

  const resetBill = useCallback(() => {
    cart.clear()
    setRemarks("")
    setFlat({ type: "percent", value: 0 })
    setAdditionalCharges(0)
    setRoundOff(false)
    setCouponCode("")
    setTableNo("")
    setCustomer(null)
    setQuote(null)
  }, [cart])

  const addItem = useCallback((item) => {
    if (item.stockQty != null && Number(item.stockQty) <= 0) {
      toast.error(`${item.name} is out of stock`)
      return
    }
    cart.addItem(item)
  }, [cart])

  const pay = useCallback(async (mode, { print = false, tenders } = {}) => {
    if (!cart.lines.length || busy) return
    if (mode === "pay_later" && !customer) {
      toast.error("Pay later needs a customer — pick one or add a phone number")
      return
    }
    if (mode === "multiple" && !tenders) { setModal("multiple"); return }
    // A card swipe is recorded, not just taken: the machine's transaction
    // number is what a chargeback is traced by, and nobody goes back for it.
    if (mode === "card" && !tenders) { setCardWillPrint(print); setModal("card"); return }
    if (orderType === "dine_in" && !tableNo) { setModal("table"); return }

    setBusy(true)
    try {
      const res = await restaurantAPI.posCreateOrder({ ...billInput(), paymentMode: mode, tenders })
      const receipt = res?.data?.data?.receipt
      toast.success(`Bill ${receipt?.billNo || ""} saved · ₹${receipt?.pricing?.total ?? ""}`)
      setLastBill(receipt || null)
      if ((print || autoPrint) && receipt) printReceipt(receipt)
      const customerId = customer?.id
      resetBill()
      setModal(null)
      if (customerId) loadSummary(customerId)
    } catch (err) {
      toast.error(errMsg(err, "The sale could not be saved"))
    } finally {
      setBusy(false)
    }
  }, [cart.lines.length, busy, customer, orderType, tableNo, billInput, autoPrint, resetBill, loadSummary])

  const hold = useCallback(async (print) => {
    if (!cart.lines.length || busy) return
    setBusy(true)
    try {
      const estimatedTotal = quote?.pricing?.total ?? Math.max(0, cart.totals.gross - cart.totals.lineDiscount)
      await restaurantAPI.posHold({
        ...billInput(),
        items: cart.lines.map((l) => ({ itemId: l.itemId, name: l.name, price: l.price, quantity: Number(l.quantity) || 1, discount: lineDiscount(l) })),
        estimatedTotal,
      })
      if (print) {
        printReceipt(
          {
            billNo: "HOLD",
            createdAt: new Date(),
            orderType,
            orderTypeLabel: ORDER_TYPE_LABEL[orderType],
            tableNo,
            salesman,
            remarks,
            store: restaurant ? { name: restaurant.restaurantName, address: [restaurant.addressLine1, restaurant.city].filter(Boolean).join(", "), phone: restaurant.ownerPhone } : null,
            customer: { name: customer?.name || "Walk in Customer", phone: customer?.phone || "" },
            items: (quote?.items || cart.lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.price, discount: lineDiscount(l), amount: l.price * l.quantity - lineDiscount(l) }))),
            pricing: quote?.pricing || { subtotal: cart.totals.gross, total: estimatedTotal, discount: cart.totals.lineDiscount },
            payment: {},
          },
          { title: "Held bill", held: true },
        )
      }
      toast.success("Bill held")
      resetBill()
    } catch (err) {
      toast.error(errMsg(err, "Could not hold the bill"))
    } finally {
      setBusy(false)
    }
  }, [cart, busy, quote, billInput, orderType, tableNo, salesman, remarks, restaurant, customer, resetBill])

  const resumeHeld = useCallback((held) => {
    if (!held) return
    resetBill()
    cart.load(held.items || [])
    setOrderType(held.orderType || "walk_in")
    setTableNo(held.tableNo || "")
    setRemarks(held.remarks || "")
    setFlat(held.flatDiscount?.value ? { type: held.flatDiscount.type || "percent", value: held.flatDiscount.value } : { type: "percent", value: 0 })
    setAdditionalCharges(Number(held.additionalCharges) || 0)
    setRoundOff(Boolean(held.roundOff))
    setCouponCode(held.couponCode || "")
    if (held.customer?.userId || held.customer?.phone) {
      setCustomer({ id: held.customer.userId || null, name: held.customer.name || "", phone: held.customer.phone || "" })
    }
    setModal(null)
  }, [cart, resetBill])

  const printLast = useCallback(() => {
    if (!lastBill) { toast.error("No bill to print yet"); return }
    if (!printReceipt(lastBill)) toast.error("The browser blocked the print window — allow pop-ups for this site")
  }, [lastBill])

  const scanInvoice = useCallback(async (ref) => {
    const key = String(ref || "").trim()
    if (!key) return
    try {
      const res = await restaurantAPI.posGetBill(key)
      const receipt = res?.data?.data
      if (receipt) { setLastBill(receipt); printReceipt(receipt) }
      setInvoiceRef("")
    } catch (err) {
      toast.error(errMsg(err, "No bill with that number"))
    }
  }, [])

  // The F-keys printed on the buttons. Off while a dialog is open so Enter/F-keys
  // inside it do not fire a sale behind it.
  useEffect(() => {
    const onKey = (e) => {
      const action = KEY_ACTIONS[e.key]
      if (!action || modal) return
      e.preventDefault()
      if (action.hold) hold(Boolean(action.print))
      else pay(action.mode, { print: Boolean(action.print) })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [modal, hold, pay])

  const couponApplied = Boolean(couponCode) && Boolean(quote?.pricing?.appliedCoupon)
  const disabled = cart.lines.length === 0 || busy

  return (
    <div className="flex h-screen flex-col bg-[#f4f7fb] text-gray-800">
      <PosTopBar
        orderType={orderType}
        onOrderType={(t) => { setOrderType(t); if (t === "dine_in" && !tableNo) setModal("table") }}
        salesman={salesman}
        salesmen={salesmen}
        onSalesman={setSalesman}
        autoPrint={autoPrint}
        onAutoPrint={setAutoPrint}
        onPrintLast={printLast}
        onSync={loadMenu}
        syncing={menuLoading}
        onClearBill={resetBill}
        hasLines={cart.lines.length > 0}
      />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-2 p-2">
          <div className="flex items-stretch gap-3">
            <PosProductSearch items={menuItems} onAdd={addItem} />
            <PosCustomerBox customer={customer} onChange={setCustomer} />
            <input
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && scanInvoice(invoiceRef)}
              placeholder="Scan Sales Invoice"
              className="h-10 w-[27%] min-w-[220px] rounded border border-gray-300 bg-white px-3 text-[15px] outline-none placeholder:text-gray-400 focus:border-sky-400"
            />
          </div>

          {orderType === "dine_in" || couponCode ? (
            <div className="flex flex-wrap items-center gap-2">
              {orderType === "dine_in" ? (
                <button type="button" onClick={() => setModal("table")} className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                  Table: {tableNo || "not set"} · change
                </button>
              ) : null}
              {/* A coupon can stop applying after it was picked — the cashier
                  removes a line and the bill drops below its minimum. The strip
                  would just show no discount, so say which it is. */}
              {couponCode ? (
                <button
                  type="button"
                  onClick={() => setModal("coupon")}
                  className={`rounded px-2 py-0.5 text-xs ${couponApplied ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                >
                  {couponApplied
                    ? `${couponCode} · −₹${quote?.pricing?.discount ?? 0}`
                    : `${couponCode} no longer applies · change`}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col rounded border border-gray-200 bg-white">
            <PosCartTable lines={cart.lines} onUpdate={cart.updateLine} onRemove={cart.removeLine} />
          </div>

          <input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Remarks"
            className="h-10 w-full rounded border border-gray-300 bg-white px-3 text-[15px] outline-none placeholder:text-gray-500 focus:border-sky-400"
          />

          <PosTotalsStrip
            totals={cart.totals}
            quote={quote}
            quoting={quoting}
            flat={flat}
            onFlat={setFlat}
            additionalCharges={additionalCharges}
            onAdditionalCharges={() => setModal("charges")}
            roundOff={roundOff}
            onRoundOff={setRoundOff}
            earnLoyalty
          />

          <PosPayButtons disabled={disabled} onPay={pay} onHold={hold} onCoupon={() => setModal("coupon")} hasCustomer={Boolean(customer)} />
        </main>

        <PosRightRail onOpen={setModal} summary={summary} customer={customer} lastBill={lastBill} onPrintLast={printLast} />
      </div>

      {modal === "holds" ? <PosHoldBillsModal onClose={() => setModal(null)} onResume={resumeHeld} /> : null}
      {modal === "orders" || modal === "payments" ? (
        <PosOrdersModal mode={modal} onClose={() => setModal(null)} onPaid={() => { loadLastBill(); if (customer?.id) loadSummary(customer.id) }} />
      ) : null}
      {modal === "multiple" && quote?.pricing ? (
        <PosPayScreen
          quote={quote}
          customer={customer}
          bankAccount={restaurant?.accountNumber ? `${restaurant.accountHolderName || restaurant.restaurantName || "Account"} · ${String(restaurant.accountNumber).slice(-4).padStart(8, "•")}${restaurant.ifscCode ? ` · ${restaurant.ifscCode}` : ""}` : ""}
          busy={busy}
          onBack={() => setModal(null)}
          // The Pay screen always prints: it is the deliberate path a cashier
          // walks for a split or a cash-with-change sale, and the change due is
          // on the bill. The auto-print toggle governs the quick F-keys, which
          // is what the separate Cash / Cash & Print pair is for.
          onProceed={(tenders) => pay("multiple", { tenders, print: true })}
        />
      ) : null}
      {modal === "coupon" ? (
        <PosCouponModal
          current={couponCode}
          invoiceBalance={quote?.pricing?.total ?? 0}
          items={couponItems}
          customerId={customer?.id}
          onClose={() => setModal(null)}
          onApply={(code) => { setCouponCode(code); setModal(null) }}
        />
      ) : null}
      {modal === "charges" ? (
        <PosChargesModal current={additionalCharges} onClose={() => setModal(null)} onApply={(n) => { setAdditionalCharges(n); setModal(null) }} />
      ) : null}
      {modal === "card" && quote?.pricing ? (
        <PosCardDetailsModal
          total={quote.pricing.total}
          bankAccounts={bankAccounts}
          hasCustomer={Boolean(customer)}
          busy={busy}
          onClose={() => setModal(null)}
          onFinalize={(card) =>
            pay("card", { print: cardWillPrint || autoPrint, tenders: [{ mode: "card", ...card }] })
          }
        />
      ) : null}
      {modal === "table" ? (
        <PosTableModal current={tableNo} onClose={() => setModal(null)} onApply={(t) => { setTableNo(t); setModal(null) }} />
      ) : null}
    </div>
  )
}
