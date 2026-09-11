import { useState } from "react"
import PosModal, { btnDark, btnLight, inputCls } from "./PosModal"
import { money } from "./posUtils"

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
