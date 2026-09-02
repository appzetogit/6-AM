import { useState, useEffect, useCallback } from "react"
import { Wallet, TrendingDown } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const INR = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = [currentYear, currentYear - 1, currentYear - 2]

export default function WalletDashboard() {
  const [year, setYear] = useState(currentYear)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  const fetchDashboard = useCallback(async (selectedYear) => {
    setLoading(true)
    try {
      const res = await adminAPI.getWalletDashboard({ year: selectedYear })
      setData(res?.data?.data || null)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load wallet dashboard")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard(year)
  }, [year, fetchDashboard])

  const monthly = data?.monthly || []

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen w-full max-w-full overflow-x-hidden">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Wallet Dashboard</h1>
      <p className="text-sm text-slate-500 mb-6">
        Platform-wide customer wallet ledger — recharges, cashback, refunds, referral credits and spend, by month.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Wallet Balance</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {loading ? "…" : INR(data?.totalWalletBalance)}
            </p>
            <p className="text-xs text-slate-400 mt-1">Sum of every customer's current wallet balance</p>
          </div>
          <div className="h-11 w-11 rounded-full bg-emerald-50 flex items-center justify-center">
            <Wallet className="h-5 w-5 text-emerald-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Today's Spending</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {loading ? "…" : INR(data?.todaySpending)}
            </p>
            <p className="text-xs text-slate-400 mt-1">Wallet-paid order value today, across all customers</p>
          </div>
          <div className="h-11 w-11 rounded-full bg-rose-50 flex items-center justify-center">
            <TrendingDown className="h-5 w-5 text-rose-600" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Monthly Ledger</h2>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4">Recharge</th>
                <th className="py-2 pr-4">Cashback</th>
                <th className="py-2 pr-4">Refund</th>
                <th className="py-2 pr-4">Referral</th>
                <th className="py-2 pr-4">Spent</th>
                <th className="py-2 pr-4">Net</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">Loading…</td>
                </tr>
              ) : monthly.every((row) => row.netBalance === 0 && row.rechargeAmount === 0 && row.spentAmount === 0) ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">No records found</td>
                </tr>
              ) : (
                monthly.map((row) => (
                  <tr key={row.month} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-4 font-medium text-slate-700">{row.monthLabel}</td>
                    <td className="py-2 pr-4 text-slate-600">{INR(row.rechargeAmount)}</td>
                    <td className="py-2 pr-4 text-slate-600">{INR(row.cashbackAmount)}</td>
                    <td className="py-2 pr-4 text-slate-600">{INR(row.refundAmount)}</td>
                    <td className="py-2 pr-4 text-slate-600">{INR(row.referralAmount)}</td>
                    <td className="py-2 pr-4 text-slate-600">{INR(row.spentAmount)}</td>
                    <td className="py-2 pr-4 font-semibold text-slate-900">{INR(row.netBalance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
