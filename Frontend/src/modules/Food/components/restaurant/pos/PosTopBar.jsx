import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Wifi, WifiOff, Printer, Settings, Cloud, Trash2, Maximize2, Minimize2, X, LogOut, PanelLeft, Headset } from "lucide-react"
import { getCompanyName, getModuleLogoUrl } from "@food/utils/businessSettings"
import { ORDER_TYPES } from "./posUtils"

const iconBtn = "rounded p-1.5 text-gray-600 hover:bg-white/70 hover:text-gray-900 disabled:opacity-40"

/**
 * The strip across the top of the till: how the order is being taken, who is
 * ringing it up, and the row of utility icons on the right.
 */
export default function PosTopBar({
  orderType,
  onOrderType,
  salesman,
  salesmen,
  onSalesman,
  autoPrint,
  onAutoPrint,
  onPrintLast,
  onSync,
  onClearBill,
  hasLines,
  syncing,
}) {
  const navigate = useNavigate()
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine))
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement))
  const companyName = getCompanyName() || "Store"
  const logoUrl = getModuleLogoUrl("restaurant")

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    const fs = () => setFullscreen(Boolean(document.fullscreenElement))
    window.addEventListener("online", up)
    window.addEventListener("offline", down)
    document.addEventListener("fullscreenchange", fs)
    return () => {
      window.removeEventListener("online", up)
      window.removeEventListener("offline", down)
      document.removeEventListener("fullscreenchange", fs)
    }
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.()
  }

  return (
    <header className="flex items-center gap-4 bg-[#eaf1f8] px-3 py-1.5 text-sm">
      <button type="button" className={iconBtn} onClick={() => navigate("/seller/dashboard")} title="Back to dashboard">
        <PanelLeft size={18} />
      </button>

      <div className="flex items-center gap-2 min-w-[110px]">
        {logoUrl ? <img src={logoUrl} alt="" className="h-7 w-auto object-contain" /> : null}
        <span className="text-xl font-extrabold tracking-tight text-[#2b3a67]">{companyName}<span className="text-sky-500">.</span></span>
      </div>

      {/* Pills rather than radios, matching the Orders page's status tabs — the
          same choice-of-one control, and the one the panel already uses.
          Buttons carry the radio roles themselves so dropping the real inputs
          does not drop what a screen reader is told. */}
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Order type">
        {ORDER_TYPES.map((t) => {
          const active = orderType === t.value
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onOrderType(t.value)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                active ? "bg-[#FA0272] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[15px] text-gray-800">Salesman:</span>
        <select
          value={salesman}
          onChange={(e) => onSalesman(e.target.value)}
          className="h-8 min-w-[180px] rounded border border-gray-300 bg-white px-2 text-sm text-gray-700 outline-none"
        >
          {salesmen.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2" title="Print the bill automatically after every sale">
        <span className="relative inline-block h-5 w-10">
          <input type="checkbox" className="peer sr-only" checked={autoPrint} onChange={(e) => onAutoPrint(e.target.checked)} />
          <span className="absolute inset-0 rounded-full bg-gray-300 transition peer-checked:bg-sky-500" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </span>
      </label>

      <button
        type="button"
        onClick={() => navigate("/seller/help-centre/support")}
        className="flex items-center gap-1.5 text-[15px] text-gray-800 hover:text-sky-600"
      >
        <Headset size={18} className="text-gray-500" /> Support Desk
      </button>

      <div className="ml-auto flex items-center gap-0.5">
        <span className={iconBtn} title={online ? "Online" : "Offline — sales will fail until the connection is back"}>
          {online ? <Wifi size={18} className="text-emerald-500" /> : <WifiOff size={18} className="text-red-500" />}
        </span>
        <button type="button" className={iconBtn} onClick={onPrintLast} title="Print last bill"><Printer size={18} /></button>
        <button type="button" className={iconBtn} onClick={() => navigate("/seller/outlet-info")} title="Outlet settings"><Settings size={18} /></button>
        <button type="button" className={iconBtn} onClick={onSync} disabled={syncing} title="Reload products"><Cloud size={18} className={syncing ? "animate-pulse" : ""} /></button>
        <button type="button" className={iconBtn} onClick={onClearBill} disabled={!hasLines} title="Clear bill"><Trash2 size={18} /></button>
        <button type="button" className={iconBtn} onClick={toggleFullscreen} title={fullscreen ? "Exit full screen" : "Full screen"}>
          {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <button type="button" className={iconBtn} onClick={onClearBill} disabled={!hasLines} title="New bill"><X size={18} /></button>
        <button type="button" className={iconBtn} onClick={() => navigate("/seller/dashboard")} title="Exit POS"><LogOut size={18} /></button>
      </div>
    </header>
  )
}
