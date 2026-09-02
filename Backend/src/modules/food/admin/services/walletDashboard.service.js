import mongoose from 'mongoose';
import { FoodUserWallet } from '../../user/models/userWallet.model.js';

const MONTH_LABELS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Classifies a wallet ledger entry into one of the five buckets the
 * dashboard reports on. `addition` covers three real sources (top-up,
 * cashback, referral) distinguished only by description/metadata today —
 * there's no dedicated `source` enum on the schema, so this mirrors exactly
 * how each caller currently writes the description.
 */
const BUCKET_EXPR = {
    $switch: {
        branches: [
            { case: { $eq: ['$transactions.type', 'deduction'] }, then: 'spent' },
            { case: { $eq: ['$transactions.type', 'refund'] }, then: 'refund' },
            {
                case: {
                    $or: [
                        { $eq: ['$transactions.metadata.source', 'cashback'] },
                        { $regexMatch: { input: { $ifNull: ['$transactions.description', ''] }, regex: /cashback/i } },
                    ],
                },
                then: 'cashback',
            },
            {
                case: {
                    $regexMatch: { input: { $ifNull: ['$transactions.description', ''] }, regex: /referral/i },
                },
                then: 'referral',
            },
        ],
        default: 'recharge',
    },
};

/**
 * Platform-wide wallet ledger, aggregated per calendar month for `year`.
 * Mirrors a "Wallet Dashboard" style report: how much came in (recharge,
 * cashback, refund, referral) vs went out (spent) each month, plus the
 * platform's current total wallet balance and today's spend.
 */
export async function getWalletDashboard({ year } = {}) {
    const targetYear = Number(year) || new Date().getFullYear();
    const rangeStart = new Date(targetYear, 0, 1, 0, 0, 0, 0);
    const rangeEnd = new Date(targetYear + 1, 0, 1, 0, 0, 0, 0);

    const [monthlyRows, totals, todaySpend] = await Promise.all([
        FoodUserWallet.aggregate([
            { $unwind: '$transactions' },
            { $match: { 'transactions.createdAt': { $gte: rangeStart, $lt: rangeEnd } } },
            {
                $project: {
                    month: { $month: '$transactions.createdAt' },
                    amount: '$transactions.amount',
                    bucket: BUCKET_EXPR,
                },
            },
            {
                $group: {
                    _id: { month: '$month', bucket: '$bucket' },
                    total: { $sum: '$amount' },
                },
            },
        ]),
        FoodUserWallet.aggregate([
            { $group: { _id: null, totalBalance: { $sum: '$balance' } } },
        ]),
        FoodUserWallet.aggregate([
            { $unwind: '$transactions' },
            {
                $match: {
                    'transactions.type': 'deduction',
                    'transactions.createdAt': {
                        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
                        $lt: new Date(new Date().setHours(24, 0, 0, 0)),
                    },
                },
            },
            { $group: { _id: null, total: { $sum: '$transactions.amount' } } },
        ]),
    ]);

    const byMonth = new Map();
    for (let m = 1; m <= 12; m++) {
        byMonth.set(m, { rechargeAmount: 0, cashbackAmount: 0, refundAmount: 0, referralAmount: 0, spentAmount: 0 });
    }
    for (const row of monthlyRows) {
        const month = row._id.month;
        const bucket = row._id.bucket;
        const entry = byMonth.get(month);
        if (!entry) continue;
        const key = `${bucket}Amount`;
        if (key in entry) entry[key] = round2((entry[key] || 0) + row.total);
    }

    const monthly = Array.from(byMonth.entries()).map(([month, row]) => {
        const netBalance = round2(
            row.rechargeAmount + row.cashbackAmount + row.refundAmount + row.referralAmount - row.spentAmount
        );
        return {
            month,
            monthLabel: MONTH_LABELS[month - 1],
            ...row,
            netBalance,
        };
    });

    return {
        year: targetYear,
        totalWalletBalance: round2(totals?.[0]?.totalBalance),
        todaySpending: round2(todaySpend?.[0]?.total),
        monthly,
    };
}
