import { useCallback, useEffect, useState } from "react"
import { Delete } from "lucide-react"
import { money, round2 } from "./posUtils"

/**
 * The cash drawer keypad.
 *
 * A cashier takes a note, not an amount: they are handed ₹100 for a ₹59 bill
 * and need the change worked out before the customer's hand comes back. So the
 * quick-add keys are denominations, and the change is live rather than shown
 * after the fact.
 *
 * Tendered starts at the bill and is replaced whole by the first key pressed —
 * the common case is a round note, not an edit of the exact total. Taking less
 * than the bill is allowed and becomes a due, which needs a named customer:
 * said here, before the sale, rather than as a failure after it.
 */

const QUICK_ADDS = [5, 100, 10, 500, 20, 2000, 50]
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]

const key =
  "flex h-14 items-center justify-center rounded border border-neutral-200 bg-white text-xl text-gray-800 transition hover:bg-neutral-50 active:bg-neutral-100"
const quickKey =
  "flex h-14 items-center justify-center rounded border border-neutral-200 bg-white text-lg font-medium text-gray-700 transition hover:bg-neutral-50 active:bg-neutral-100"
const box = "flex h-14 items-center justify-center rounded-md border-2 text-2xl"

export default function PosCashTenderModal({ due, hasCustomer, busy, onCancel, onSubmit }) {
  const [tendered, setTendered] = useState(String(round2(due)))
  // The prefilled amount is a suggestion; the first key replaces it rather
  // than appending to it, which is what the selected text in the box implies.
  const [pristine, setPristine] = useState(true)

  const value = Number(tendered) || 0
  const change = round2(Math.max(0, value - due))
  const shortfall = round2(Math.max(0, due - value))

  const problem =
    value <= 0
      ? "Enter the amount taken"
      : shortfall > 0 && !hasCustomer
        ? "Short of the bill — pick a customer to leave the rest as Pay Later"
        : null

  const press = useCallback((ch) => {
    setTendered((current) => {
      const base = pristine ? "" : current
      if (ch === ".") return base.includes(".") ? base : `${base || "0"}.`
      return `${base}${ch}`.replace(/^0+(?=\d)/, "")
    })
    setPristine(false)
  }, [pristine])

  const addNote = useCallback((n) => {
    // Adding to a prefilled bill total would mean "bill plus ₹100", which is
    // never what a handed-over note means. The first note replaces.
    setTendered((current) => String(round2((pristine ? 0 : Number(current) || 0) + n)))
    setPristine(false)
  }, [pristine])

  const backspace = useCallback(() => {
    setTendered((current) => (pristine ? "" : current.slice(0, -1)))
    setPristine(false)
  }, [pristine])

  const clear = useCallback(() => {
    setTendered("")
    setPristine(false)
  }, [])

  const submit = useCallback(() => {
    if (problem || busy) return
    onSubmit(round2(value))
  }, [problem, busy, onSubmit, value])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= "0" && e.key <= "9") { e.preventDefault(); press(e.key) }
      else if (e.key === ".") { e.preventDefault(); press(".") }
      else if (e.key === "Backspace") { e.preventDefault(); backspace() }
      else if (e.key === "Enter") { e.preventDefault(); submit() }
      else if (e.key === "Escape") { e.preventDefault(); onCancel() }
      // The F-keys stay dead while this is open, so Cash & Print cannot fire a
      // second sale behind the dialog collecting the first one.
      else if (/^F\d{1,2}$/.test(e.key)) e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [press, backspace, submit, onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onCancel}>
      <div
        className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Cash tendered"
      >
        <div className="grid grid-cols-3 gap-5 text-center">
          <div>
            <p className="mb-2 text-xl text-gray-700">Due Amount</p>
            <div className={`${box} border-emerald-400 bg-neutral-100 text-gray-700`}>{money(due, 1)}</div>
          </div>
          <div>
            <p className="mb-2 text-xl text-gray-700">Tendered</p>
            <div className={`${box} border-neutral-800 bg-white font-medium ${pristine ? "bg-sky-100" : ""}`}>
              {tendered || "0"}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xl text-gray-700">Change</p>
            <div className={`${box} border-transparent bg-purple-400 text-white`}>{money(change, 1)}</div>
          </div>
        </div>

        <div className="mt-5 flex gap-4">
          <div className="grid flex-1 grid-cols-5 gap-2">
            {[0, 1, 2].map((row) => (
              <Row key={row} row={row} press={press} addNote={addNote} />
            ))}
            <button type="button" className={key} onClick={clear}>C</button>
            <button type="button" className={key} onClick={() => press("0")}>0</button>
            <button type="button" className={key} onClick={() => press(".")}>.</button>
            <button type="button" className={quickKey} onClick={() => addNote(50)}>+50</button>
            <button type="button" className={`${key} bg-neutral-800 text-white hover:bg-black`} onClick={backspace} aria-label="Backspace">
              <Delete className="h-5 w-5" />
            </button>
          </div>

          <div className="flex w-56 shrink-0 flex-col gap-3">
            <button
              type="button"
              disabled={Boolean(problem) || busy}
              onClick={submit}
              className="flex-1 rounded bg-sky-300 text-2xl font-semibold text-gray-900 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
            >
              {busy ? "Saving…" : "Submit"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded bg-red-400 text-2xl font-semibold text-white transition hover:bg-red-500"
            >
              Cancel
            </button>
          </div>
        </div>

        {problem ? (
          <p className="mt-4 text-center text-sm text-rose-600">{problem}</p>
        ) : shortfall > 0 ? (
          <p className="mt-4 text-center text-sm text-amber-700">₹{money(shortfall, 2)} will be left as Pay Later</p>
        ) : null}
      </div>
    </div>
  )
}

/** One keypad row: three digits, then two denominations. */
function Row({ row, press, addNote }) {
  const notes = [QUICK_ADDS[row * 2], QUICK_ADDS[row * 2 + 1]]
  return (
    <>
      {DIGITS.slice(row * 3, row * 3 + 3).map((d) => (
        <button key={d} type="button" className={key} onClick={() => press(d)}>{d}</button>
      ))}
      {notes.map((n) => (
        <button key={n} type="button" className={quickKey} onClick={() => addNote(n)}>
          +{String(n).padStart(2, "0")}
        </button>
      ))}
    </>
  )
}
