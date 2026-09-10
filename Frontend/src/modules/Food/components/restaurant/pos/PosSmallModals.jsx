import { useState } from "react"
import PosModal, { btnDark, btnLight, inputCls } from "./PosModal"
import { money } from "./posUtils"

/** Apply a coupon code. Whether it took is the server's call, shown from the quote. */
export function PosCouponModal({ current, applied, onClose, onApply }) {
  const [code, setCode] = useState(current || "")
  return (
    <PosModal
      title="Apply Coupon"
      onClose={onClose}
      width="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          {current ? <button type="button" className={btnLight} onClick={() => onApply("")}>Remove</button> : null}
          <button type="button" className={btnLight} onClick={onClose}>Cancel</button>
          <button type="button" className={btnDark} disabled={!code.trim()} onClick={() => onApply(code.trim().toUpperCase())}>Apply</button>
        </div>
      }
    >
      <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="COUPON CODE" autoFocus onKeyDown={(e) => e.key === "Enter" && code.trim() && onApply(code.trim().toUpperCase())} />
      {current ? (
        <p className={`mt-2 text-xs ${applied ? "text-emerald-600" : "text-amber-600"}`}>
          {applied ? `${current} applied` : `${current} did not apply to this bill (expired, below minimum, or not for this store)`}
        </p>
      ) : null}
    </PosModal>
  )
}

/** Extra charges typed in by hand — a service charge, a carry bag. */
export function PosChargesModal({ current, onClose, onApply }) {
  const [value, setValue] = useState(current ? String(current) : "")
  const n = Math.max(0, Number(value) || 0)
  return (
    <PosModal
      title="Additional Charges"
      onClose={onClose}
      width="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btnLight} onClick={onClose}>Cancel</button>
          <button type="button" className={btnDark} onClick={() => onApply(n)}>Set ₹{money(n, 2)}</button>
        </div>
      }
    >
      <input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus onKeyDown={(e) => e.key === "Enter" && onApply(n)} />
    </PosModal>
  )
}

/** Dine-in asks for a table; there is no table map, so it is a plain field. */
export function PosTableModal({ current, onClose, onApply }) {
  const [value, setValue] = useState(current || "")
  return (
    <PosModal
      title="Table number"
      onClose={onClose}
      width="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btnLight} onClick={onClose}>Cancel</button>
          <button type="button" className={btnDark} onClick={() => onApply(value.trim())}>Set</button>
        </div>
      }
    >
      <input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. T4" autoFocus onKeyDown={(e) => e.key === "Enter" && onApply(value.trim())} />
    </PosModal>
  )
}
