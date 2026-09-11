import { useState } from "react"
import PosModal from "./PosModal"
import { money, round2 } from "./posUtils"

/**
 * What the counter records when a card is swiped.
 *
 * The machine takes the money; this captures what a chargeback or a settlement
 * query would later be traced by — the transaction number above all. Every
 * field except the amount is optional, because a shop that does not record
 * them still takes cards, and a dialog that refuses to close over a blank
 * "customer bank name" would just get filled with a full stop.
 *
 * The amount is editable and defaults to the whole bill. Taking less leaves
 * the rest owed, which needs a named customer — the same rule as every other
 * short payment, said here before the cashier commits rather than after.
 */

const label = "mb-1.5 block text-[15px] font-medium text-gray-800"
const field =
  "h-11 w-full rounded border border-gray-300 bg-white px-3 text-[15px] text-gray-800 outline-none focus:border-sky-400 placeholder:text-gray-400"

export default function PosCardDetailsModal({ total, bankAccounts = [], hasCustomer, busy, onClose, onFinalize }) {
  const [form, setForm] = useState({
    bankAccount: "",
    customerBank: "",
    amount: String(round2(total)),
    cardHolder: "",
    transactionNo: "",
  })
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const amount = Number(form.amount) || 0
  const due = round2(Math.max(0, total - amount))
  const over = round2(Math.max(0, amount - total))

  const problem =
    amount <= 0
      ? "Enter the amount taken on the card"
      : over > 0
        ? `₹${money(over, 2)} more than the bill — a card cannot be over-charged`
        : due > 0 && !hasCustomer
          ? "Taking less than the bill leaves a due — pick a customer first"
          : null

  return (
    <PosModal
      title="Card Details"
      onClose={onClose}
      width="max-w-md"
      footer={
        <div className="space-y-2">
          {due > 0 && !problem ? (
            <p className="text-center text-sm text-amber-700">₹{money(due, 2)} will be left as Pay Later</p>
          ) : null}
          {problem ? <p className="text-center text-sm text-rose-600">{problem}</p> : null}
          <button
            type="button"
            disabled={Boolean(problem) || busy}
            onClick={() => onFinalize({ ...form, amount: round2(form.amount) })}
            className="mx-auto block rounded bg-[#1f1f1f] px-6 py-2.5 text-[15px] font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Finalize Payment"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <span className={label}>Payment Account</span>
          <select className={field} value={form.bankAccount} onChange={(e) => set({ bankAccount: e.target.value })}>
            <option value="">Select Bank</option>
            {bankAccounts.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          {bankAccounts.length === 0 ? (
            <p className="mt-1 text-xs text-gray-500">
              No bank account saved for this store — add one under Bank details to name it here.
            </p>
          ) : null}
        </div>

        <div>
          <span className={label}>Customer Bank Name</span>
          <input
            className={field}
            value={form.customerBank}
            onChange={(e) => set({ customerBank: e.target.value })}
            placeholder="Customer bank Name"
          />
        </div>

        <div>
          <span className={label}>Card Payment Amount</span>
          <input
            className={field}
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
            inputMode="decimal"
            autoFocus
          />
        </div>

        <div>
          <span className={label}>Card Holder Name</span>
          <input
            className={field}
            value={form.cardHolder}
            onChange={(e) => set({ cardHolder: e.target.value })}
            placeholder="Card holder name"
          />
        </div>

        <div>
          <span className={label}>Card Transaction No.</span>
          <input
            className={field}
            value={form.transactionNo}
            onChange={(e) => set({ transactionNo: e.target.value })}
            placeholder="Card Transaction No."
            onKeyDown={(e) => {
              if (e.key === "Enter" && !problem && !busy) onFinalize({ ...form, amount: round2(form.amount) })
            }}
          />
        </div>
      </div>
    </PosModal>
  )
}
