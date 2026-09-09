import MasterPanel, { BRAND_PANEL, CATEGORY_PANEL } from "./MasterPanel"

/**
 * Items > Category / Brand — the reference ERP's single screen holding both
 * lists side by side, each with its own search, page size and Create New.
 *
 * They stack on narrow screens rather than shrinking to unreadable columns.
 */
export default function CategoryBrand() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2 text-lg">
        <span className="font-semibold text-neutral-900">Category/Brand</span>
        <span className="text-neutral-300">|</span>
        <span className="text-neutral-400">⌂</span>
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <MasterPanel config={CATEGORY_PANEL} />
        <MasterPanel config={BRAND_PANEL} />
      </div>
    </div>
  )
}
