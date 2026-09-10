import { useEffect, useRef, useState } from "react"
import { X, ChevronDown, Pencil } from "lucide-react"
import { restaurantAPI } from "@food/api"
import PosModal, { btnDark, btnLight, inputCls } from "./PosModal"

/**
 * "Walk in Customer" — the customer picker.
 *
 * Empty means an anonymous walk-in. Typing digits looks a phone up anywhere;
 * typing letters looks a name up among this shop's own customers. The pencil
 * lets the cashier type a name and number for someone new, who is created
 * when the bill is saved, not before — an abandoned bill should leave no
 * ghost customer behind.
 */
export default function PosCustomerBox({ customer, onChange }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    const needle = q.trim()
    if (needle.length < 2) { setResults([]); return undefined }
    timer.current = setTimeout(async () => {
      try {
        const res = await restaurantAPI.posSearchCustomers(needle)
        setResults(Array.isArray(res?.data?.data) ? res.data.data : [])
        setOpen(true)
      } catch {
        setResults([])
      }
    }, 250)
    return () => clearTimeout(timer.current)
  }, [q])

  const label = customer ? `${customer.name || "Customer"}${customer.phone ? ` · ${customer.phone}` : ""}` : ""

  return (
    <div className="relative flex w-[27%] min-w-[260px] items-stretch gap-1.5">
      <div className="relative flex flex-1 items-center rounded border border-gray-300 bg-white">
        <input
          value={customer ? label : q}
          readOnly={Boolean(customer)}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Walk in Customer"
          className="h-10 w-full bg-transparent px-3 text-[15px] text-gray-800 outline-none placeholder:text-gray-700"
        />
        {customer || q ? (
          <button type="button" className="px-1 text-gray-500 hover:text-gray-800" onClick={() => { onChange(null); setQ(""); setResults([]) }} aria-label="Clear customer">
            <X size={14} />
          </button>
        ) : null}
        <span className="px-2 text-gray-500"><ChevronDown size={16} /></span>
        {open && results.length > 0 ? (
          <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded border border-gray-200 bg-white shadow-lg">
            {results.map((c) => (
              <li
                key={c.id}
                onMouseDown={() => { onChange(c); setQ(""); setOpen(false) }}
                className="cursor-pointer px-3 py-2 text-sm hover:bg-sky-50"
              >
                <span className="font-medium text-gray-800">{c.name || "Unnamed"}</span>
                <span className="ml-2 text-gray-500">{c.phone}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button type="button" onClick={() => setEditing(true)} className="rounded bg-gray-200 px-3 text-gray-700 hover:bg-gray-300" title="Add / edit customer">
        <Pencil size={16} />
      </button>

      {editing ? (
        <EditCustomer
          initial={customer}
          onClose={() => setEditing(false)}
          onSave={(c) => { onChange(c); setEditing(false); setQ("") }}
        />
      ) : null}
    </div>
  )
}

function EditCustomer({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || "")
  const [phone, setPhone] = useState(initial?.phone || "")
  const digits = phone.replace(/\D/g, "")
  const valid = digits.length === 10

  return (
    <PosModal
      title={initial?.id ? "Customer" : "New customer"}
      onClose={onClose}
      width="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={btnLight} onClick={onClose}>Cancel</button>
          <button type="button" className={btnDark} disabled={!valid} onClick={() => onSave({ id: initial?.id || null, name: name.trim(), phone: digits })}>
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-500">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-500">Mobile number</span>
          <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" inputMode="numeric" />
          {!valid && phone ? <span className="mt-1 block text-xs text-red-500">Enter a 10-digit mobile number</span> : null}
        </label>
        {initial?.id ? <p className="text-xs text-gray-500">Existing customers are identified by phone; the name here is what prints on the bill.</p> : null}
      </div>
    </PosModal>
  )
}
