import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X, UploadCloud, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { restaurantAPI, uploadAPI } from "@food/api"
import { Switch } from "@food/components/ui/switch"

const GST_OPTIONS = [
  { value: "", label: "None" },
  { value: "5", label: "5%" },
  { value: "12", label: "12%" },
  { value: "18", label: "18%" },
  { value: "28", label: "28%" },
]

/**
 * Right-side "Edit Item" panel opened from the Menu/Inventory page's item
 * rows — replaces the previous full-page navigation to ItemDetailsPage for
 * quick edits. Only surfaces fields the FoodItem model actually persists
 * (see food.model.js): no per-item packaging charge, unit-of-measure, item
 * labels or subscription toggle exist on that model, so this deliberately
 * doesn't fake them.
 */
export default function EditItemDrawer({ item, category, categories, onClose, onSaved }) {
  const isOpen = Boolean(item)
  const fileInputRef = useRef(null)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [foodType, setFoodType] = useState("Non-Veg")
  const [categoryId, setCategoryId] = useState("")
  const [price, setPrice] = useState("")
  const [mrp, setMrp] = useState("")
  const [gstRate, setGstRate] = useState("")
  const [sku, setSku] = useState("")
  const [unlimitedQty, setUnlimitedQty] = useState(true)
  const [stockQty, setStockQty] = useState("")
  const [isAvailable, setIsAvailable] = useState(true)
  const [isRecommended, setIsRecommended] = useState(false)
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false)
  const [image, setImage] = useState("")
  const [imageFile, setImageFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!item) return
    setName(item.name || "")
    setDescription(item.description || "")
    setFoodType(item.foodType === "Veg" ? "Veg" : "Non-Veg")
    setCategoryId(item.categoryId || category?.id || "")
    setPrice(item.price != null ? String(item.price) : "")
    setMrp(item.mrp != null ? String(item.mrp) : "")
    setGstRate(item.gstRate != null ? String(item.gstRate) : "")
    setSku(item.sku || "")
    setStockQty(item.stockQty != null ? String(item.stockQty) : "")
    setUnlimitedQty(item.stockQty == null)
    setIsAvailable(item.isAvailable !== false)
    setIsRecommended(item.isRecommended === true)
    setSubscriptionEnabled(item.subscriptionEnabled === true)
    setImage(item.image || "")
    setImageFile(null)
    setConfirmingDelete(false)
  }, [item, category])

  const handleImagePick = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImage(URL.createObjectURL(file))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please enter an item name")
      return
    }
    const parsedPrice = Number(price)
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error("Please enter a valid selling price")
      return
    }
    if (mrp && Number(mrp) < parsedPrice) {
      toast.error("MRP cannot be lower than the selling price")
      return
    }

    setSaving(true)
    try {
      let imageUrl = image
      if (imageFile) {
        setUploadingImage(true)
        const uploadRes = await uploadAPI.uploadMedia(imageFile, {
          folder: "switcheats/restaurant/menu-items",
        }).catch(() => uploadAPI.uploadMedia(imageFile))
        imageUrl = uploadRes?.data?.data?.url || uploadRes?.data?.url || image
        setUploadingImage(false)
      }

      const selectedCategory = categories?.find((c) => String(c.id) === String(categoryId))

      const payload = {
        name: name.trim(),
        description: description.trim(),
        foodType,
        price: parsedPrice,
        mrp: mrp === "" ? null : Number(mrp),
        gstRate: gstRate === "" ? null : Number(gstRate),
        sku: sku.trim(),
        stockQty: unlimitedQty ? null : Number(stockQty) || 0,
        isAvailable,
        isRecommended,
        subscriptionEnabled,
        image: imageUrl,
        ...(selectedCategory
          ? { categoryId: selectedCategory.id, categoryName: selectedCategory.name }
          : {}),
      }

      await restaurantAPI.updateFood(item.id, payload)
      toast.success("Item updated successfully")
      onSaved?.({ ...item, ...payload })
      onClose()
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to update item")
    } finally {
      setSaving(false)
      setUploadingImage(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setSaving(true)
    try {
      await restaurantAPI.deleteFood(item.id)
      toast.success("Item deleted")
      onSaved?.(null, item.id)
      onClose()
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to delete item")
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-white z-50 flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
              <h2 className="text-lg font-bold text-gray-900">Edit Item</h2>
              <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">
                  Basic Information
                </h3>

                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  Item Image <span className="normal-case font-normal">(Optional)</span>
                </label>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden hover:border-gray-400 transition-colors mb-4"
                >
                  {image ? (
                    <img src={image} alt={name} className="w-full h-full object-cover" />
                  ) : (
                    <UploadCloud className="w-6 h-6 text-gray-400" />
                  )}
                </button>

                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  * Name (English)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 mb-4 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="Item name"
                />

                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Type</label>
                <div className="grid grid-cols-2 gap-2 mb-1">
                  {["Veg", "Non-Veg"].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setFoodType(type)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                        foodType === type
                          ? type === "Veg"
                            ? "border-green-600 text-green-700 bg-green-50"
                            : "border-red-600 text-red-700 bg-red-50"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {type === "Veg" ? "Veg" : "Non Veg"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pricing & Stock */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">
                  Pricing & Stock
                </h3>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">SKU</label>
                    <input
                      type="text"
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      placeholder="Enter SKU"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">GST</label>
                    <select
                      value={gstRate}
                      onChange={(e) => setGstRate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    >
                      {GST_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                      * Selling Price
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Item MRP</label>
                    <input
                      type="number"
                      min="0"
                      value={mrp}
                      onChange={(e) => setMrp(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5 mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Unlimited Quantity</p>
                    <p className="text-xs text-gray-500">Never run out of stock</p>
                  </div>
                  <Switch checked={unlimitedQty} onCheckedChange={setUnlimitedQty} />
                </div>

                {!unlimitedQty && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                      * Quantity
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={stockQty}
                      onChange={(e) => setStockQty(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>
                )}
              </div>

              {/* Menu */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">Menu</h3>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  {!categories?.length && <option value="">No categories</option>}
                  {categories?.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">Description</h3>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Describe this item (optional)"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>

              {/* Item Settings */}
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">
                  Item Settings
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Active Status</p>
                      <p className="text-xs text-gray-500">Make this item visible to customers</p>
                    </div>
                    <Switch checked={isAvailable} onCheckedChange={setIsAvailable} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Featured Item</p>
                      <p className="text-xs text-gray-500">Show as recommended on menu</p>
                    </div>
                    <Switch checked={isRecommended} onCheckedChange={setIsRecommended} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Subscription</p>
                      <p className="text-xs text-gray-500">Enable this item for subscription</p>
                    </div>
                    <Switch checked={subscriptionEnabled} onCheckedChange={setSubscriptionEnabled} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-200 shrink-0 bg-white">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-orange-500 rounded-lg text-sm font-semibold text-white hover:bg-orange-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving && !confirmingDelete ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {uploadingImage ? "Uploading..." : "Save Item"}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className={`px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-60 ${
                  confirmingDelete ? "bg-red-700 hover:bg-red-800" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {confirmingDelete ? "Confirm?" : "Delete"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
