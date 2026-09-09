import { useCallback, useEffect, useState } from "react"
import { Calendar, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"

/**
 * Dashboard analytics widgets, laid out as the reference ERP lays them out:
 * Top 20 Customers and the customer-segment column across the top with Category
 * Sales beside them, then Best and Least Selling Product side by side.
 *
 * Each panel owns its own date range, because that is how the reference behaves
 * — an operator comparing this month's categories against today's product mix
 * should not have to move both.
 */

const pad = (n) => String(n).padStart(2, "0")
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)) }
const monthEnd = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
const today = () => iso(new Date())

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const num = (n) => Number(n || 0).toLocaleString("en-IN")
const pct = (n) => `${Number(n || 0).toFixed(2)}`

/** Two date inputs in one control, matching the reference's range field. */
function RangePicker({ from, to, onChange }) {
  return (
    <div className="flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700">
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => onChange({ from: e.target.value || from, to })}
        className="w-[104px] bg-transparent outline-none"
        aria-label="From date"
      />
      <span className="text-neutral-400">–</span>
      <input
        type="date"
        value={to}
        min={from}
        onChange={(e) => onChange({ from, to: e.target.value || to })}
        className="w-[104px] bg-transparent outline-none"
        aria-label="To date"
      />
      <Calendar className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
    </div>
  )
}

function Panel({ title, range, onRangeChange, children }) {
  return (
    <section className="flex flex-col rounded-md border border-neutral-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-800">{title}</h2>
        {range && <RangePicker from={range.from} to={range.to} onChange={onRangeChange} />}
      </header>
      <div className="flex-1 overflow-x-auto px-4 pb-4">{children}</div>
    </section>
  )
}

const Th = ({ children, right }) => (
  <th className={`border-b border-neutral-200 bg-neutral-100 px-3 py-2 font-semibold ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
)
const Td = ({ children, right, link }) => (
  <td className={`border-b border-neutral-100 px-3 py-2 ${right ? "text-right" : ""} ${link ? "text-sky-600" : "text-neutral-700"}`}>
    {children}
  </td>
)

const Empty = ({ cols, children }) => (
  <tr><td colSpan={cols} className="px-3 py-10 text-center text-sm text-neutral-500">{children}</td></tr>
)
const Busy = ({ cols }) => (
  <tr><td colSpan={cols} className="px-3 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-neutral-400" /></td></tr>
)

/** One coloured segment tile. The count leads; the label explains it. */
function SegmentCard({ label, value, tone, title }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-4 py-5 text-center shadow-sm" title={title}>
      <div className={`text-2xl font-semibold leading-none ${tone}`}>{value}</div>
      <div className={`mt-1.5 text-sm font-medium ${tone}`}>{label}</div>
    </div>
  )
}

/** Small hook: one panel's data, refetched when its own range moves. */
function usePanel(fetcher, initialRange) {
  const [range, setRange] = useState(initialRange)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fetcher(range))
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load dashboard data")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [fetcher, range])

  useEffect(() => { load() }, [load])
  return { range, setRange, data, loading }
}

export default function DashboardAnalytics() {
  const customers = usePanel(
    useCallback(async (r) => (await adminAPI.getTopCustomers({ ...r, limit: 20 }))?.data?.data, []),
    { from: monthStart(), to: monthEnd() }
  )
  const categories = usePanel(
    useCallback(async (r) => (await adminAPI.getCategorySales(r))?.data?.data, []),
    { from: today(), to: today() }
  )
  const best = usePanel(
    useCallback(async (r) => (await adminAPI.getProductSales({ ...r, order: "best", limit: 10 }))?.data?.data, []),
    { from: monthStart(), to: monthEnd() }
  )
  const least = usePanel(
    useCallback(async (r) => (await adminAPI.getProductSales({ ...r, order: "least", limit: 10 }))?.data?.data, []),
    { from: monthStart(), to: monthEnd() }
  )

  const [segments, setSegments] = useState(null)
  useEffect(() => {
    ;(async () => {
      try {
        setSegments((await adminAPI.getCustomerSegments())?.data?.data)
      } catch {
        // A failed segment count leaves the tiles at zero rather than blanking
        // the whole dashboard; the tables beside it are independent.
        setSegments(null)
      }
    })()
  }, [])

  const seg = segments?.counts || {}
  const rules = segments?.rules?.describe || {}

  const productRows = (panel, cols) => {
    if (panel.loading) return <Busy cols={cols} />
    const rows = panel.data?.products || []
    if (!rows.length) return <Empty cols={cols}>No sales in this period.</Empty>
    return rows.map((p, i) => (
      <tr key={p.productId || i}>
        <Td>{i + 1}</Td>
        <Td link>{p.productName}</Td>
        <Td right>{num(p.bills)}</Td>
        <Td right>{num(p.salesQty)}</Td>
        <Td right>{money(p.salesAmount)}</Td>
        <Td right>{money(p.profit)}</Td>
        <Td right>{pct(p.salesPercent)}</Td>
      </tr>
    ))
  }

  const ProductPanel = ({ title, panel }) => (
    <Panel title={title} range={panel.range} onRangeChange={panel.setRange}>
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr>
            <Th>#</Th><Th>Product Name</Th><Th right>No. of Bills</Th><Th right>Sales Qty</Th>
            <Th right>Sales Amount</Th><Th right>Profit</Th><Th right>Sales(%)</Th>
          </tr>
        </thead>
        <tbody>{productRows(panel, 7)}</tbody>
      </table>
    </Panel>
  )

  return (
    <div className="space-y-4">
      {/* Row 1 — top customers | segment column | category sales */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_auto_1.3fr]">
        <Panel title="Top 20 Customers" range={customers.range} onRangeChange={customers.setRange}>
          <table className="w-full min-w-[380px] text-sm">
            <thead>
              <tr><Th>#</Th><Th>Customer Name</Th><Th right>No. of Bills</Th><Th right>Sales Value</Th></tr>
            </thead>
            <tbody>
              {customers.loading ? <Busy cols={4} />
                : !(customers.data?.customers || []).length ? <Empty cols={4}>No sales in this period.</Empty>
                : customers.data.customers.map((c) => (
                  <tr key={c.customerId || c.rank}>
                    <Td link>{c.rank}</Td>
                    <Td link>{c.customerName}</Td>
                    <Td right>{num(c.bills)}</Td>
                    <Td right>{money(c.salesValue)}</Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Panel>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[190px] xl:grid-cols-1">
          <SegmentCard label="VIP Customer" value={num(seg.vip ?? 0)} tone="text-teal-600" title={rules.vip} />
          <SegmentCard label="Regular Customer" value={num(seg.regular ?? 0)} tone="text-sky-600" title={rules.regular} />
          <SegmentCard label="Risk Customer" value={num(seg.risk ?? 0)} tone="text-amber-500" title={rules.risk} />
          <SegmentCard label="Lost Customer" value={num(seg.lost ?? 0)} tone="text-rose-500" title={rules.lost} />
        </div>

        <Panel title="Category Sales" range={categories.range} onRangeChange={categories.setRange}>
          <table className="w-full min-w-[460px] text-sm">
            <thead>
              <tr>
                <Th>#</Th><Th>Category Name</Th><Th right>Sales Qty</Th>
                <Th right>Sales Amount</Th><Th right>Profit</Th><Th right>Sales(%)</Th>
              </tr>
            </thead>
            <tbody>
              {categories.loading ? <Busy cols={6} />
                : !(categories.data?.categories || []).length ? <Empty cols={6}>No sales in this period.</Empty>
                : categories.data.categories.map((c, i) => (
                  <tr key={c.categoryId || c.categoryName}>
                    <Td>{i + 1}</Td>
                    <Td>{c.categoryName}</Td>
                    <Td right>{num(c.salesQty)}</Td>
                    <Td right>{money(c.salesAmount)}</Td>
                    <Td right>{money(c.profit)}</Td>
                    <Td right>{pct(c.salesPercent)}</Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Row 2 — best | least selling */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ProductPanel title="Best Selling Product" panel={best} />
        <ProductPanel title="Least Selling Product" panel={least} />
      </div>
    </div>
  )
}
