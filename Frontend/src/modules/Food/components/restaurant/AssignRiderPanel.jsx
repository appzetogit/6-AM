import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Bike, Loader2, Circle } from "lucide-react"
import { restaurantAPI } from "@food/api"

/**
 * Handing one order to one of the seller's own riders.
 *
 * Automatic dispatch does not run for a seller with their own fleet — the
 * dispatcher skips them — so without this the order simply waits. Shown only
 * while the order still needs a rider; once one is assigned the pane above
 * shows who it is instead.
 */
export default function AssignRiderPanel({ orderId, onAssigned }) {
  const [fleet, setFleet] = useState([])
  const [loading, setLoading] = useState(true)
  const [assigningId, setAssigningId] = useState(null)

  const loadFleet = useCallback(async () => {
    setLoading(true)
    try {
      const res = await restaurantAPI.getDeliveryFleet()
      setFleet(res?.data?.data?.fleet || [])
    } catch {
      // Quietly empty: the panel then points at the fleet page, which is the
      // useful next step whether the call failed or there are simply no riders.
      setFleet([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFleet()
  }, [loadFleet])

  const assign = async (rider) => {
    setAssigningId(rider._id)
    try {
      await restaurantAPI.assignDeliveryPartner(orderId, rider._id)
      toast.success(`${rider.name || "Rider"} is on it`)
      onAssigned?.(rider)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not assign that rider")
    } finally {
      setAssigningId(null)
    }
  }

  const freeFirst = [...fleet].sort(
    (a, b) => (a.activeOrderCount || 0) - (b.activeOrderCount || 0),
  )

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3" data-testid="assign-rider">
      <div className="flex items-center gap-1.5 mb-2">
        <Bike className="w-3.5 h-3.5 text-gray-500" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
          Assign a rider
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-gray-500 flex items-center gap-1.5 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading your fleet…
        </p>
      ) : freeFirst.length === 0 ? (
        <p className="text-xs text-gray-500 py-1">
          No riders in your fleet yet. Add one under Delivery → Delivery fleet.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {freeFirst.map((rider) => {
            const busy = (rider.activeOrderCount || 0) > 0
            return (
              <div
                key={rider._id}
                data-testid="assign-rider-row"
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">
                    {rider.name || "Rider"}
                  </p>
                  <p className="text-[10px] text-gray-500 flex items-center gap-1">
                    <Circle
                      className={`w-1.5 h-1.5 fill-current ${busy ? "text-amber-500" : "text-emerald-500"}`}
                    />
                    {busy
                      ? `${rider.activeOrderCount} in hand`
                      : "free"}
                    {rider.vehicleNumber ? ` · ${rider.vehicleNumber}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => assign(rider)}
                  disabled={assigningId === rider._id}
                  className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-50 shrink-0 flex items-center gap-1"
                >
                  {assigningId === rider._id && <Loader2 className="w-3 h-3 animate-spin" />}
                  Assign
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
