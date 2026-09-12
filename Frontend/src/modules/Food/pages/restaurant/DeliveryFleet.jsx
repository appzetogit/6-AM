import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Bike, Loader2, Plus, Trash2, Circle } from "lucide-react"
import { restaurantAPI } from "@food/api"

/**
 * The seller's own riders.
 *
 * A seller running their own fleet gets no automatic dispatch — the dispatcher
 * skips them deliberately — so handing an order to one of these riders is the
 * only way their orders reach the door. This screen is where the fleet is put
 * together; the assigning happens on the order itself.
 */

const statusTone = (status) => {
  const value = String(status || "").toLowerCase()
  if (value === "online" || value === "available") return { label: "Online", cls: "text-emerald-600" }
  if (value === "busy" || value === "on_delivery") return { label: "On a delivery", cls: "text-amber-600" }
  return { label: "Offline", cls: "text-gray-400" }
}

export default function DeliveryFleet() {
  const [fleet, setFleet] = useState([])
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState("")
  const [linking, setLinking] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const loadFleet = useCallback(async () => {
    setLoading(true)
    try {
      const res = await restaurantAPI.getDeliveryFleet()
      setFleet(res?.data?.data?.fleet || [])
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load your fleet")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFleet()
  }, [loadFleet])

  const handleLink = async (e) => {
    e.preventDefault()
    const trimmed = phone.trim()
    if (!trimmed) {
      toast.error("Enter the rider's phone number")
      return
    }
    setLinking(true)
    try {
      await restaurantAPI.linkDeliveryPartner(trimmed)
      toast.success("Rider added to your fleet")
      setPhone("")
      loadFleet()
    } catch (err) {
      // The server distinguishes "no such rider", "not approved yet" and
      // "already with another seller"; all three are worth reading as-is.
      toast.error(err?.response?.data?.message || "Could not add that rider")
    } finally {
      setLinking(false)
    }
  }

  const handleUnlink = async (rider) => {
    setBusyId(rider._id)
    try {
      await restaurantAPI.unlinkDeliveryPartner(rider._id)
      toast.success(`${rider.name || "Rider"} removed from your fleet`)
      loadFleet()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not remove that rider")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-gray-50 min-h-screen">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
            <Bike className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Delivery fleet</h1>
            <p className="text-sm text-gray-500">
              Your own riders. Orders are handed to them by hand from the order screen —
              automatic dispatch does not run for a seller with their own fleet.
            </p>
          </div>
        </div>

        <form onSubmit={handleLink} className="mt-5 flex flex-col sm:flex-row gap-2">
          <input
            type="tel"
            value={phone}
            data-testid="fleet-phone"
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Rider's registered phone number"
            className="flex-1 px-3 py-2.5 text-sm rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <button
            type="submit"
            disabled={linking}
            data-testid="fleet-add"
            className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-gray-900 text-white hover:bg-black disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add rider
          </button>
        </form>
        <p className="text-[11px] text-gray-400 mt-2">
          The rider must already be registered and approved on the platform.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading your fleet…
          </div>
        ) : fleet.length === 0 ? (
          <div className="py-16 text-center px-6">
            <Bike className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-700">No riders yet</p>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Add a rider by their registered phone number to start handing them orders.
            </p>
          </div>
        ) : (
          fleet.map((rider) => {
            const tone = statusTone(rider.availabilityStatus)
            return (
              <div
                key={rider._id}
                data-testid="fleet-row"
                className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{rider.name || "Rider"}</p>
                    <span className={`text-[11px] font-medium flex items-center gap-1 ${tone.cls}`}>
                      <Circle className="w-2 h-2 fill-current" />
                      {tone.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {rider.phone}
                    {rider.vehicleNumber ? ` · ${rider.vehicleNumber}` : ""}
                    {" · "}
                    {rider.activeOrderCount > 0
                      ? `${rider.activeOrderCount} order${rider.activeOrderCount > 1 ? "s" : ""} in hand`
                      : "free"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleUnlink(rider)}
                  disabled={busyId === rider._id}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                >
                  {busyId === rider._id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Remove
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
