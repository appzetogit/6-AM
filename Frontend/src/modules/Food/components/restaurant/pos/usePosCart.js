import { useCallback, useMemo, useState } from "react"
import { lineFromItem, localTotals } from "./posUtils"

/**
 * The lines on the bill and what can be done to them.
 *
 * Scanning the same product twice bumps its quantity rather than adding a
 * second line, which is what a barcode scanner user expects; a second line
 * for the same item is only ever created deliberately, by editing.
 */
export default function usePosCart() {
  const [lines, setLines] = useState([])

  const addItem = useCallback((item, quantity = 1) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId === String(item.id))
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], quantity: Number(next[idx].quantity) + quantity }
        return next
      }
      return [...prev, { ...lineFromItem(item), quantity }]
    })
  }, [])

  const updateLine = useCallback((key, patch) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }, [])

  const removeLine = useCallback((key) => {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  /** Rehydrate from a held bill — held lines carry itemId/name/price/quantity/discount. */
  const load = useCallback((heldLines = []) => {
    setLines(
      heldLines.map((l) => ({
        ...lineFromItem({ id: l.itemId, name: l.name, price: l.price }),
        quantity: Number(l.quantity) || 1,
        discountPct: 0,
        addDisc: Number(l.discount) || 0,
      })),
    )
  }, [])

  const totals = useMemo(() => localTotals(lines), [lines])

  return { lines, addItem, updateLine, removeLine, clear, load, totals }
}
