import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"
import { canCurrentAdminAction } from "@food/utils/adminRbac"

/**
 * Items > Stock Verification — the list of physical counts, one row per
 * verification. Create New opens a fresh count; Open continues a draft or shows
 * a completed one read-only.
 */
const STATUS = {
  draft: { label: "Draft", cls: "bg-amber-500" },
  completed: { label: "Completed", cls: "bg-emerald-500" },
  cancelled: { label: "Cancelled", cls: "bg-neutral-400" },
}
const when = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—")

export default function StockVerification() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [status, setStatus] = useState("")
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [menuFor, setMenuFor] = useState(null)
  const canCreate = canCurrentAdminAction("create", "/admin/store/stock-verification")
  const canEdit = canCurrentAdminAction("edit", "/admin/store/stock-verification")
  const canDelete = canCurrentAdminAction("delete", "/admin/store/stock-verification")
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    const id = window.setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300)
    return () => window.clearTimeout(id)
  }, [search])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit: pageSize }
      if (debounced) params.search = debounced
      if (status) params.status = status
      const res = await adminAPI.getStockVerifications(params)
      setRows(res?.data?.data?.verifications || [])
      setTotal(Number(res?.data?.data?.total) || 0)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load verifications")
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, debounced, status])

  useEffect(() => { fetchRows() }, [fetchRows])

  const act = async (fn, okMsg) => {
    setMenuFor(null)
    try {
      await fn()
      toast.success(okMsg)
      fetchRows()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Action failed")
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2 text-lg">
        <span className="font-semibold text-neutral-900">Stock Verification</span>
        <span className="text-neutral-300">|</span>
        <span className="text-neutral-400">⌂</span>
      </div>

      <div className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm">
            <option value="">All Status</option><option value="draft">Draft</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm">{[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          <div className="relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search List..." className="h-9 w-52 rounded border border-neutral-300 bg-white pl-3 pr-8 text-sm outline-none focus:border-sky-500" />
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          </div>
          {canCreate && <button type="button" onClick={() => navigate("/admin/store/stock-verification/new")} className="h-9 rounded bg-sky-500 px-4 text-sm font-medium text-white hover:bg-sky-600">Create New</button>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-neutral-100 text-left text-neutral-800">
              <tr>
                <th className="w-8 px-3 py-3"><input type="checkbox" disabled className="rounded border-neutral-300" /></th>
                <th className="px-3 py-3 font-semibold">Sr. No.</th>
                <th className="px-3 py-3 font-semibold">Verification No.</th>
                <th className="px-3 py-3 font-semibold">Store</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Items</th>
                <th className="px-3 py-3 font-semibold">Counted</th>
                <th className="px-3 py-3 font-semibold">Net Difference</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-14 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-neutral-400" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-14 text-center text-neutral-500">No verifications yet.</td></tr>
              ) : rows.map((v, i) => (
                <tr key={v.id} className="border-t border-neutral-100 odd:bg-white even:bg-neutral-50/60">
                  <td className="px-3 py-3"><input type="checkbox" className="rounded border-neutral-300" /></td>
                  <td className="px-3 py-3 text-sky-600">{(page - 1) * pageSize + i + 1}</td>
                  <td className="px-3 py-3"><button type="button" onClick={() => navigate(`/admin/store/stock-verification/${v.id}`)} className="font-medium text-sky-600 hover:underline">{v.verificationNo}</button></td>
                  <td className="px-3 py-3 text-neutral-700">{v.restaurantName || "—"}</td>
                  <td className="px-3 py-3 text-neutral-700">{when(v.completedAt || v.createdAt)}</td>
                  <td className="px-3 py-3 text-neutral-700">{v.itemCount}</td>
                  <td className="px-3 py-3 text-neutral-700">{v.countedCount} / {v.itemCount}</td>
                  <td className={`px-3 py-3 font-semibold ${v.totalDifference > 0 ? "text-emerald-600" : v.totalDifference < 0 ? "text-rose-600" : "text-neutral-600"}`}>{v.totalDifference > 0 ? "+" : ""}{v.totalDifference}</td>
                  <td className="px-3 py-3"><span className={`rounded px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white ${STATUS[v.status]?.cls}`}>{STATUS[v.status]?.label}</span></td>
                  <td className="relative px-3 py-3">
                    <button type="button" onClick={() => setMenuFor(menuFor === v.id ? null : v.id)} className="px-2 text-lg leading-none text-neutral-500 hover:text-neutral-800" aria-label="Actions">···</button>
                    {menuFor === v.id && (
                      <div className="absolute right-2 z-10 mt-1 w-40 rounded border border-neutral-200 bg-white py-1 text-sm shadow-lg">
                        <button type="button" onClick={() => navigate(`/admin/store/stock-verification/${v.id}`)} className="block w-full px-3 py-1.5 text-left hover:bg-neutral-50">{v.status === "draft" ? "Continue" : "Open"}</button>
                        {v.status === "draft" && canEdit && <button type="button" onClick={() => window.confirm(`Complete ${v.verificationNo}? Stock will be updated to the counted quantities.`) && act(() => adminAPI.completeStockVerification(v.id), "Verification completed — stock updated")} className="block w-full px-3 py-1.5 text-left text-emerald-700 hover:bg-emerald-50">Complete</button>}
                        {v.status === "draft" && canEdit && <button type="button" onClick={() => act(() => adminAPI.cancelStockVerification(v.id), "Verification cancelled")} className="block w-full px-3 py-1.5 text-left hover:bg-neutral-50">Cancel</button>}
                        {v.status !== "completed" && canDelete && <button type="button" onClick={() => window.confirm(`Delete ${v.verificationNo}?`) && act(() => adminAPI.deleteStockVerification(v.id), "Verification deleted")} className="block w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50">Delete</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm text-neutral-600">
          <span>Showing {rows.length ? (page - 1) * pageSize + 1 : 0} to {(page - 1) * pageSize + rows.length} of {total}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40">Prev</button>
            <span>{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </div>
  )
}
