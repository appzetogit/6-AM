import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Globe, LifeBuoy, Compass, CreditCard, ChevronRight } from "lucide-react"
import { restaurantAPI } from "@food/api"
import SellerGettingStarted from "@food/components/restaurant/SellerGettingStarted"

const BASE = "/seller"

const QUICK_LINKS = [
  {
    label: "Helpdesk & Support",
    description: "Guides, FAQs & how-to articles",
    icon: LifeBuoy,
    path: `${BASE}/help-centre/support`,
    tint: "bg-blue-50 text-blue-600",
  },
  {
    label: "Explore",
    description: "Discover platform features & tools",
    icon: Compass,
    path: `${BASE}/explore`,
    tint: "bg-emerald-50 text-emerald-600",
  },
  {
    label: "Share Your Feedback",
    description: "Tell us what to improve",
    icon: Globe,
    path: `${BASE}/share-feedback`,
    tint: "bg-purple-50 text-purple-600",
  },
  {
    label: "Subscription",
    description: "Manage your seller plan",
    icon: CreditCard,
    path: `${BASE}/subscription`,
    tint: "bg-amber-50 text-amber-600",
  },
]

const formatMoney = (value) => `₹${Number(value || 0).toFixed(2)}`

export default function Dashboard() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await restaurantAPI.getDashboardSummary()
        const data = response?.data?.data || null
        if (!cancelled) setSummary(data)
      } catch {
        // Keep null; sections render zeros below.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const accountSummary = summary?.accountSummary || {}
  const orderSummary = summary?.orderSummary || {}
  const monthlyOrders = summary?.last6MonthsOrders || []
  const monthlySignups = summary?.last6MonthsSignupCustomers || []

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-6 space-y-6">
      <SellerGettingStarted />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick Links */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Quick Links</h2>
          <div className="space-y-2">
            {QUICK_LINKS.map((link) => (
              <button
                key={link.path}
                type="button"
                onClick={() => navigate(link.path)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${link.tint} hover:brightness-95`}
              >
                <link.icon className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{link.label}</p>
                  <p className="text-xs text-gray-500 truncate">{link.description}</p>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0 text-gray-400" />
              </button>
            ))}
          </div>
        </div>

        {/* Account Summary */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Account Summary</h2>
          <div className="space-y-3">
            {[
              ["Outlet", accountSummary.outlets],
              ["Customers", accountSummary.customers],
              ["Delivery Zones", accountSummary.deliveryZones],
              ["Coupons", accountSummary.coupons],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-semibold text-orange-500">{loading ? "…" : value ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Order Summary */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Order Summary</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">No of Orders</span>
              <span className="font-bold text-gray-900">{loading ? "…" : orderSummary.noOfOrders ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Revenue</span>
              <span className="font-bold text-gray-900">{loading ? "…" : formatMoney(orderSummary.revenue)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Average Order Value</span>
              <span className="font-bold text-gray-900">{loading ? "…" : formatMoney(orderSummary.averageOrderValue)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Your Earning</span>
              <span className="font-bold text-gray-900">{loading ? "…" : formatMoney(orderSummary.yourEarning)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">Last 6 Months Orders</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyOrders}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}
                  labelStyle={{ color: "#111827" }}
                  itemStyle={{ color: "#111827" }}
                />
                <Bar dataKey="count" fill="#f97316" radius={[8, 8, 0, 0]} name="Orders" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Total: {monthlyOrders.reduce((sum, row) => sum + (row.count || 0), 0)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">Last 6 Months Signup Customer</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySignups}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}
                  labelStyle={{ color: "#111827" }}
                  itemStyle={{ color: "#111827" }}
                />
                <Bar dataKey="count" fill="#10b981" radius={[8, 8, 0, 0]} name="New Customers" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Total: {monthlySignups.reduce((sum, row) => sum + (row.count || 0), 0)}
          </p>
        </div>
      </div>
    </div>
  )
}
