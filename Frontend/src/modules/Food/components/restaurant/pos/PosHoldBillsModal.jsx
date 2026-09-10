import { useEffect, useState } from "react"
import { toast } from "sonner"
import { restaurantAPI } from "@food/api"
import PosModal, { btnDark, btnLight } from "./PosModal"
import { fmtDateTime, money, ORDER_TYPE_LABEL } from "./posUtils"

/** Parked bills. Resume puts one back on the screen and removes the hold. */
export default function PosHoldBillsModal({ onClose, onResume }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await restaurantAPI.posListHolds()
      setRows(Array.isArray(res?.data?.data) ? res.data.data : [])
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load held bills")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const resume = async (id) => {
    try {
      const res = await restaurantAPI.posResumeHold(id)
      onResume(res?.data?.data)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not resume that bill")
      load()
    }
  }

  const discard = async (id) => {
    try {
      await restaurantAPI.posDiscardHold(id)
      setRows((r) => r.filter((h) => h.id !== id))
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not discard that bill")
    }
  }

  return (
    <PosModal title="Held Bills" onClose={onClose} width="max-w-3xl">
      {loading ? <p className="py-8 text-center text-gray-500">Loading…</p> : rows.length === 0 ? (
        <p className="py-8 text-center text-gray-500">No bills on hold</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-700">
            <tr>
              <th className="px-2 py-2">Held at</th>
              <th className="px-2 py-2">Customer</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2 text-right">Items</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id} className="border-b border-gray-100">
                <td className="px-2 py-2">{fmtDateTime(h.createdAt)}</td>
                <td className="px-2 py-2">{h.customer?.name || "Walk in Customer"}{h.customer?.phone ? <span className="text-gray-500"> · {h.customer.phone}</span> : null}</td>
                <td className="px-2 py-2">{ORDER_TYPE_LABEL[h.orderType] || h.orderType}{h.tableNo ? ` · ${h.tableNo}` : ""}</td>
                <td className="px-2 py-2 text-right">{(h.items || []).reduce((s, l) => s + Number(l.quantity || 0), 0)}</td>
                <td className="px-2 py-2 text-right">₹{money(h.estimatedTotal, 2)}</td>
                <td className="px-2 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button type="button" className={btnDark} onClick={() => resume(h.id)}>Resume</button>
                    <button type="button" className={btnLight} onClick={() => discard(h.id)}>Discard</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PosModal>
  )
}
