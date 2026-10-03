const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');

/**
 * @route   GET /api/analytics/monthly-history
 * @desc    Get month-wise spending history for graphs (last 12 months)
 * @access  Private
 */
router.get('/monthly-history', protect, async (req, res, next) => {
  try {
    const monthsBack = parseInt(req.query.months, 10) || 6;
    const now = new Date();

    // Generate list of previous N months in "YYYY-MM" format
    const monthKeys = [];
    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${yyyy}-${mm}`;
      monthKeys.push({
        key,
        label: `${monthNames[d.getMonth()]} ${yyyy.toString().slice(-2)}`,
        fullLabel: `${monthNames[d.getMonth()]} ${yyyy}`,
        year: yyyy,
        month: d.getMonth() + 1,
      });
    }

    const startDate = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

    // Aggregate monthly spending
    const monthlyStats = await Transaction.aggregate([
      {
        $match: {
          user: req.user._id,
          date: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: '$billingMonth',
          totalSpent: { $sum: '$amount' },
          transactionCount: { $sum: 1 },
          maxExpense: { $max: '$amount' },
          avgExpense: { $avg: '$amount' },
        },
      },
    ]);

    const statsMap = {};
    monthlyStats.forEach((stat) => {
      statsMap[stat._id] = stat;
    });

    const userPersonalLimit = req.user.personalLimit;
    const userCardLimit = req.user.cardLimit;

    const history = monthKeys.map((m) => {
      const stat = statsMap[m.key] || {
        totalSpent: 0,
        transactionCount: 0,
        maxExpense: 0,
        avgExpense: 0,
      };

      const total = Math.round(stat.totalSpent * 100) / 100;
      const isOverLimit = total > userPersonalLimit;
      const percentOfLimit = userPersonalLimit > 0 ? Math.round((total / userPersonalLimit) * 100) : 0;

      return {
        monthKey: m.key,
        label: m.label,
        fullLabel: m.fullLabel,
        totalSpent: total,
        transactionCount: stat.transactionCount,
        maxExpense: Math.round((stat.maxExpense || 0) * 100) / 100,
        avgExpense: Math.round((stat.avgExpense || 0) * 100) / 100,
        personalLimit: userPersonalLimit,
        cardLimit: userCardLimit,
        isOverLimit,
        percentOfLimit,
      };
    });

    // Calculate overall stats
    const totalSpentPeriod = history.reduce((sum, h) => sum + h.totalSpent, 0);
    const avgMonthly = history.length > 0 ? Math.round(totalSpentPeriod / history.length) : 0;
    const peakMonth = history.reduce((max, h) => (h.totalSpent > max.totalSpent ? h : max), history[0] || {});

    res.json({
      success: true,
      data: {
        history,
        summary: {
          totalSpentPeriod,
          avgMonthly,
          peakMonth: peakMonth.fullLabel || 'N/A',
          peakAmount: peakMonth.totalSpent || 0,
          personalLimit: userPersonalLimit,
          cardLimit: userCardLimit,
          currencySymbol: req.user.currencySymbol,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/analytics/categories
 * @desc    Get category breakdown for a specific month or all-time
 * @access  Private
 */
router.get('/categories', protect, async (req, res, next) => {
  try {
    const { month } = req.query; // Optional "YYYY-MM"

    const match = { user: req.user._id };
    if (month && month.trim()) {
      match.billingMonth = month.trim();
    }

    const categoryStats = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$category',
          totalSpent: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalSpent: -1 } },
    ]);

    const totalSpending = categoryStats.reduce((acc, curr) => acc + curr.totalSpent, 0);

    const categories = categoryStats.map((item) => ({
      category: item._id,
      totalSpent: Math.round(item.totalSpent * 100) / 100,
      count: item.count,
      percentage: totalSpending > 0 ? Math.round((item.totalSpent / totalSpending) * 1000) / 10 : 0,
    }));

    res.json({
      success: true,
      data: {
        totalSpending,
        categories,
        month: month || 'All Time',
        currencySymbol: req.user.currencySymbol,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
