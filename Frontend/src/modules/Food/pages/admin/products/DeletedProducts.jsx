import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ImageIcon, Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"
import { canCurrentAdminAction } from "@food/utils/adminRbac"

/**
 * "Deleted Products" — the reference ERP's recycle bin for the product list.
 * Deleting from the main list is a soft delete that lands here; a row can be
 * restored, or removed for good.
 */
export default function DeletedProducts() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const canDelete = canCurrentAdminAction("delete", "/admin/store/products")
  const canEdit = canCurrentAdminAction("edit", "/admin/store/products")
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [search])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit: pageSize }
      if (debouncedSearch) params.search = debouncedSearch
      const res = await adminAPI.getDeletedFoods(params)
      setRows(res?.data?.data?.foods || [])
      setTotal(Number(res?.data?.data?.total) || 0)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load deleted products")
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, debouncedSearch])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const restore = async (row) => {
    try {
      await adminAPI.restoreFood(row.id)
      toast.success("Product restored")
      fetchRows()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Restore failed")
    }
  }

  const purge = async (row) => {
    if (!window.confirm(`Permanently delete "${row.name}"? This cannot be undone.`)) return
    try {
      await adminAPI.purgeFood(row.id)
      toast.success("Product permanently deleted")
      fetchRows()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Delete failed")
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-lg">
          <span className="font-semibold text-neutral-900">Deleted Products</span>
          <span className="text-neutral-300">|</span>
          <span className="text-neutral-400">⌂</span>
        </div>
        <Link to="/admin/store/products" className="text-sm text-sky-600 hover:underline">← Back to Products</Link>
      </div>

      <div className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm">
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search List..." className="h-9 w-52 rounded border border-neutral-300 bg-white pl-3 pr-8 text-sm outline-none focus:border-sky-500" />
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-neutral-100 text-left text-neutral-800">
              <tr>
                <th className="px-3 py-3 font-semibold">Sr. No.</th>
                <th className="px-3 py-3 font-semibold">Image</th>
                <th className="px-3 py-3 font-semibold">Item Code</th>
                <th className="px-3 py-3 font-semibold">Category</th>
                <th className="px-3 py-3 font-semibold">Brand</th>
                <th className="px-3 py-3 font-semibold">Name</th>
                <th className="px-3 py-3 font-semibold">MRP</th>
                <th className="px-3 py-3 font-semibold">Deleted On</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-14 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-neutral-400" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-14 text-center text-neutral-500">No deleted products.</td></tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={row.id} className="border-t border-neutral-100 odd:bg-white even:bg-neutral-50/60">
                    <td className="px-3 py-3 text-sky-600">{(page - 1) * pageSize + i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="grid h-12 w-12 place-items-center overflow-hidden rounded border border-neutral-200 bg-white">
                        {row.image ? <img src={row.image} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-neutral-300" />}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-neutral-700">{row.itemCode || "—"}</td>
                    <td className="px-3 py-3 text-neutral-700">{row.categoryName || "—"}</td>
                    <td className="px-3 py-3 text-neutral-700">{row.brandName || "—"}</td>
                    <td className="px-3 py-3 font-medium text-neutral-800">{row.name}</td>
                    <td className="px-3 py-3 text-neutral-700">{row.mrp ?? ""}</td>
                    <td className="px-3 py-3 text-neutral-700">{row.deletedAt ? new Date(row.deletedAt).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        {canEdit && <button type="button" onClick={() => restore(row)} className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600">Restore</button>}
                        {canDelete && <button type="button" onClick={() => purge(row)} className="rounded bg-rose-500 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600">Delete Permanently</button>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
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
