import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"

/**
 * One stock verification: pick a store, load its tracked products (or add
 * specific ones), enter what was physically counted, and Complete.
 *
 * Book Qty is the figure snapshotted when the line was added; Difference is
 * counted − book. Completing writes each counted line to the item's stockQty
 * and to the ledger. A completed verification opens read-only.
 */
const qty = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(2))
const STATUS = { draft: "bg-amber-500", completed: "bg-emerald-500", cancelled: "bg-neutral-400" }

export default function StockVerificationForm() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [v, setV] = useState(null) // the verification (after create/load)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)

  // create step
  const [stores, setStores] = useState([])
  const [restaurantId, setRestaurantId] = useState("")
  const [note, setNote] = useState("")
  const [creating, setCreating] = useState(false)

  // line edits (draft)
  const [counts, setCounts] = useState({}) // lineId -> string
  const [lineNotes, setLineNotes] = useState({})
  const [addSearch, setAddSearch] = useState("")
  const [addResults, setAddResults] = useState([])

  const readOnly = v && v.status !== "draft"

  useEffect(() => {
    ;(async () => {
      try {
        const r = await adminAPI.getRestaurants({ limit: 1000 })
        setStores(r?.data?.data?.restaurants || r?.data?.restaurants || [])
      } catch { /* store select stays empty */ }
    })()
  }, [])

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        const res = await adminAPI.getStockVerification(id)
        hydrate(res?.data?.data)
      } catch {
        toast.error("Verification not found")
        navigate("/admin/store/stock-verification")
      } finally {
        setLoading(false)
      }
    })()
  }, [id, navigate])

  const hydrate = (data) => {
    setV(data)
    setNote(data?.note || "")
    const c = {}, n = {}
    ;(data?.items || []).forEach((l) => { c[l.id] = l.countedQty === null ? "" : String(l.countedQty); n[l.id] = l.note || "" })
    setCounts(c); setLineNotes(n)
  }

  const create = async () => {
    if (!restaurantId) return toast.error("Select a store")
    setCreating(true)
    try {
      const res = await adminAPI.createStockVerification({ restaurantId, note })
      const data = res?.data?.data
      toast.success(`${data.verificationNo} created with ${data.itemCount} product(s)`)
      navigate(`/admin/store/stock-verification/${data.id}`, { replace: true })
      hydrate(data)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not create verification")
    } finally {
      setCreating(false)
    }
  }

  const linesPayload = () => v.items.map((l) => ({ id: l.id, countedQty: counts[l.id] === "" ? null : Number(counts[l.id]), note: lineNotes[l.id] || "" }))

  const saveDraft = async (silent = false) => {
    setSaving(true)
    try {
      const res = await adminAPI.updateStockVerification(v.id, { note, items: linesPayload() })
      hydrate(res?.data?.data)
      if (!silent) toast.success("Draft saved")
      return true
    } catch (error) {
      toast.error(error?.response?.data?.message || "Save failed")
      return false
    } finally {
      setSaving(false)
    }
  }

  const complete = async () => {
    const counted = Object.values(counts).filter((x) => x !== "").length
    if (!counted) return toast.error("Enter a counted quantity for at least one product")
    if (!window.confirm(`Complete ${v.verificationNo}? ${counted} product(s) will be set to their counted quantity.`)) return
    if (!(await saveDraft(true))) return
    setSaving(true)
    try {
      const res = await adminAPI.completeStockVerification(v.id)
      hydrate(res?.data?.data)
      toast.success("Verification completed — stock updated")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not complete")
    } finally {
      setSaving(false)
    }
  }

  const removeLine = async (line) => {
    try {
      const res = await adminAPI.updateStockVerification(v.id, { removeLineIds: [line.id] })
      hydrate(res?.data?.data)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not remove")
    }
  }

  useEffect(() => {
    if (!v || readOnly) return
    const term = addSearch.trim()
    if (!term) { setAddResults([]); return }
    const t = window.setTimeout(async () => {
      try {
        const res = await adminAPI.getFoods({ restaurantId: v.restaurantId, search: term, limit: 8 })
        const have = new Set(v.items.map((l) => l.itemId))
        setAddResults((res?.data?.data?.foods || []).filter((f) => !have.has(String(f.id))))
      } catch { setAddResults([]) }
    }, 300)
    return () => window.clearTimeout(t)
  }, [addSearch, v, readOnly])

  const addLine = async (food) => {
    try {
      const res = await adminAPI.updateStockVerification(v.id, { addItemIds: [food.id] })
      hydrate(res?.data?.data)
      setAddSearch(""); setAddResults([])
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not add")
    }
  }

  const totals = useMemo(() => {
    if (!v) return { counted: 0, diff: 0 }
    let counted = 0, diff = 0
    v.items.forEach((l) => { const c = counts[l.id]; if (c !== "" && c !== undefined) { counted++; diff += Number(c) - Number(l.bookQty || 0) } })
    return { counted, diff }
  }, [v, counts])

  if (loading) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-lg">
          <span className="font-semibold text-neutral-900">Stock Verification</span>
          <span className="text-neutral-300">|</span><span className="text-neutral-400">⌂</span>
          <span className="text-neutral-300">›</span>
          <span className="text-neutral-600">{v ? v.verificationNo : "Create New"}</span>
          {v && <span className={`ml-2 rounded px-2.5 py-0.5 text-[11px] font-bold uppercase text-white ${STATUS[v.status]}`}>{v.status}</span>}
        </div>
        <button type="button" onClick={() => navigate("/admin/store/stock-verification")} className="text-sm text-sky-600 hover:underline">← Back to list</button>
      </div>

      {!v ? (
        <section className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-medium text-sky-600">New Verification</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block text-sm"><span className="mb-1 block font-semibold">Store<span className="text-rose-500">*</span></span>
              <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} className="h-10 w-full rounded border border-neutral-300 px-3"><option value="">Select Store</option>{stores.map((r) => <option key={r._id || r.id} value={r._id || r.id}>{r.restaurantName || r.name}</option>)}</select>
            </label>
            <label className="block text-sm md:col-span-2"><span className="mb-1 block font-semibold">Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Month-end count" className="h-10 w-full rounded border border-neutral-300 px-3" /></label>
          </div>
          <p className="mt-3 text-xs text-neutral-500">All tracked products of the store are loaded with their current book quantity. You can add or remove products afterwards.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => navigate("/admin/store/stock-verification")} className="rounded bg-neutral-200 px-5 py-2 text-sm">Cancel</button>
            <button type="button" disabled={creating} onClick={create} className="inline-flex items-center gap-2 rounded bg-sky-500 px-5 py-2 text-sm font-medium text-white disabled:opacity-60">{creating && <Loader2 className="h-4 w-4 animate-spin" />} Start Counting</button>
          </div>
        </section>
      ) : (
        <>
          <section className="mb-4 rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="grid gap-4 text-sm md:grid-cols-4">
              <div><div className="text-xs text-neutral-500">Store</div><div className="font-medium">{v.restaurantName}</div></div>
              <div><div className="text-xs text-neutral-500">Products</div><div className="font-medium">{v.items.length}</div></div>
              <div><div className="text-xs text-neutral-500">Counted</div><div className="font-medium">{totals.counted} / {v.items.length}</div></div>
              <div><div className="text-xs text-neutral-500">Net Difference</div><div className={`font-semibold ${totals.diff > 0 ? "text-emerald-600" : totals.diff < 0 ? "text-rose-600" : ""}`}>{totals.diff > 0 ? "+" : ""}{totals.diff}</div></div>
            </div>
            <label className="mt-3 block text-sm"><span className="mb-1 block font-semibold">Note</span><input value={note} onChange={(e) => setNote(e.target.value)} disabled={readOnly} className="h-10 w-full rounded border border-neutral-300 px-3 disabled:bg-neutral-100" /></label>
          </section>

          <section className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
            {!readOnly && (
              <div className="relative mb-3 max-w-md">
                <div className="flex">
                  <input value={addSearch} onChange={(e) => setAddSearch(e.target.value)} placeholder="Add product — search by name / item code" className="h-9 w-full rounded-l border border-neutral-300 px-3 text-sm outline-none focus:border-sky-500" />
                  <span className="grid w-9 place-items-center rounded-r border border-l-0 border-neutral-300 bg-neutral-100 text-neutral-500"><Plus className="h-4 w-4" /></span>
                </div>
                {addResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded border border-neutral-200 bg-white py-1 text-sm shadow-lg">
                    {addResults.map((f) => <button key={f.id} type="button" onClick={() => addLine(f)} className="block w-full px-3 py-1.5 text-left hover:bg-neutral-50">{f.itemCode ? `${f.itemCode} · ` : ""}{f.name} <span className="text-xs text-neutral-500">(book {qty(f.stockQty)})</span></button>)}
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-neutral-100 text-left text-neutral-800">
                  <tr><th className="px-3 py-3 font-semibold">Sr. No.</th><th className="px-3 py-3 font-semibold">Item Code</th><th className="px-3 py-3 font-semibold">Name</th><th className="px-3 py-3 font-semibold">Unit</th><th className="px-3 py-3 text-right font-semibold">Book Qty</th><th className="px-3 py-3 text-right font-semibold">Counted Qty</th><th className="px-3 py-3 text-right font-semibold">Difference</th><th className="px-3 py-3 font-semibold">Note</th>{!readOnly && <th className="px-3 py-3" />}</tr>
                </thead>
                <tbody>
                  {v.items.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-10 text-center text-neutral-500">No products. Add one above.</td></tr>
                  ) : v.items.map((l, i) => {
                    const c = counts[l.id]
                    const d = c === "" || c === undefined ? null : Number(c) - Number(l.bookQty || 0)
                    return (
                      <tr key={l.id} className="border-t border-neutral-100 odd:bg-white even:bg-neutral-50/60">
                        <td className="px-3 py-2 text-sky-600">{i + 1}</td>
                        <td className="px-3 py-2 text-neutral-700">{l.itemCode || "—"}</td>
                        <td className="px-3 py-2 font-medium text-neutral-900">{l.itemName}</td>
                        <td className="px-3 py-2 text-neutral-700">{l.unitShortName || "—"}</td>
                        <td className="px-3 py-2 text-right text-neutral-700">{qty(l.bookQty)}</td>
                        <td className="px-3 py-2 text-right">{readOnly ? qty(l.countedQty) : <input type="number" min={0} step="any" value={c ?? ""} onChange={(e) => setCounts((s) => ({ ...s, [l.id]: e.target.value }))} className="h-9 w-28 rounded border border-sky-300 px-2 text-right" />}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${d === null ? "text-neutral-400" : d > 0 ? "text-emerald-600" : d < 0 ? "text-rose-600" : "text-neutral-600"}`}>{d === null ? "—" : `${d > 0 ? "+" : ""}${d}`}</td>
                        <td className="px-3 py-2">{readOnly ? (l.note || "—") : <input value={lineNotes[l.id] ?? ""} onChange={(e) => setLineNotes((s) => ({ ...s, [l.id]: e.target.value }))} className="h-9 w-full rounded border border-neutral-300 px-2" />}</td>
                        {!readOnly && <td className="px-3 py-2"><button type="button" onClick={() => removeLine(l)} className="text-rose-500" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {!readOnly && (
            <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between border-t border-neutral-200 bg-neutral-100 px-4 py-3 sm:-mx-6 sm:px-6">
              <button type="button" onClick={() => navigate("/admin/store/stock-verification")} className="rounded bg-neutral-200 px-5 py-2 text-sm font-medium">Cancel</button>
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => saveDraft(false)} className="rounded border border-sky-500 bg-white px-5 py-2 text-sm font-medium text-sky-600 disabled:opacity-60">Save Draft</button>
                <button type="button" disabled={saving} onClick={complete} className="inline-flex items-center gap-2 rounded bg-emerald-500 px-5 py-2 text-sm font-medium text-white disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Complete Verification</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
