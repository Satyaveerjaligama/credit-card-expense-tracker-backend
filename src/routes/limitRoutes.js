const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');

/**
 * Helper to calculate active billing cycle start and end dates
 */
function getBillingCycleRange(billingCycleDay = 1) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDate = now.getDate();

  let cycleStart, cycleEnd;

  if (currentDate >= billingCycleDay) {
    // Current cycle started this month on billingCycleDay
    cycleStart = new Date(currentYear, currentMonth, billingCycleDay, 0, 0, 0, 0);
    // Ends next month on billingCycleDay - 1
    cycleEnd = new Date(currentYear, currentMonth + 1, billingCycleDay - 1, 23, 59, 59, 999);
  } else {
    // Current cycle started previous month on billingCycleDay
    cycleStart = new Date(currentYear, currentMonth - 1, billingCycleDay, 0, 0, 0, 0);
    // Ends this month on billingCycleDay - 1
    cycleEnd = new Date(currentYear, currentMonth, billingCycleDay - 1, 23, 59, 59, 999);
  }

  return { cycleStart, cycleEnd };
}

/**
 * @route   GET /api/limits/overview
 * @desc    Get credit card limit, personal spending limit, spent amount, remaining amount, and alert status
 * @access  Private
 */
router.get('/overview', protect, async (req, res, next) => {
  try {
    const user = req.user;
    const { cycleStart, cycleEnd } = getBillingCycleRange(user.billingCycleDay);

    // Sum transactions in current billing cycle
    const currentExpenses = await Transaction.aggregate([
      {
        $match: {
          user: user._id,
          date: { $gte: cycleStart, $lte: cycleEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$amount' },
          transactionCount: { $sum: 1 },
        },
      },
    ]);

    const totalSpent = currentExpenses.length > 0 ? currentExpenses[0].totalSpent : 0;
    const transactionCount = currentExpenses.length > 0 ? currentExpenses[0].transactionCount : 0;

    const cardLimit = Number(user.cardLimit) || 100000;
    const personalLimit = Number(user.personalLimit) || 10000;
    const alertThreshold = Number(user.alertThreshold) || 80;

    const remainingPersonal = Math.max(0, personalLimit - totalSpent);
    const remainingCard = Math.max(0, cardLimit - totalSpent);

    const personalPercent = personalLimit > 0 ? (totalSpent / personalLimit) * 100 : 0;
    const cardPercent = cardLimit > 0 ? (totalSpent / cardLimit) * 100 : 0;

    // Determine status & warning
    let status = 'SAFE'; // SAFE, WARNING, EXCEEDED
    let warningTitle = null;
    let warningMessage = null;

    if (totalSpent > personalLimit) {
      status = 'EXCEEDED';
      const exceededAmount = (totalSpent - personalLimit).toFixed(2);
      warningTitle = 'Personal Limit Exceeded!';
      warningMessage = `You have spent ${user.currencySymbol}${totalSpent.toLocaleString()} which exceeds your personal budget of ${user.currencySymbol}${personalLimit.toLocaleString()} by ${user.currencySymbol}${Number(exceededAmount).toLocaleString()}. Please review your expenses!`;
    } else if (personalPercent >= alertThreshold) {
      status = 'WARNING';
      const remainingAmount = (personalLimit - totalSpent).toFixed(2);
      warningTitle = 'Approaching Personal Limit!';
      warningMessage = `Caution: You have utilized ${personalPercent.toFixed(1)}% of your personal limit. You have spent ${user.currencySymbol}${totalSpent.toLocaleString()} of ${user.currencySymbol}${personalLimit.toLocaleString()}. Only ${user.currencySymbol}${Number(remainingAmount).toLocaleString()} remaining!`;
    }

    res.json({
      success: true,
      data: {
        cardLimit,
        personalLimit,
        alertThreshold,
        totalSpent,
        transactionCount,
        remainingPersonal,
        remainingCard,
        personalPercent: Math.min(100, Math.round(personalPercent * 10) / 10),
        cardPercent: Math.min(100, Math.round(cardPercent * 10) / 10),
        rawPersonalPercent: personalPercent,
        status,
        warningTitle,
        warningMessage,
        cycleStart,
        cycleEnd,
        billingCycleDay: user.billingCycleDay,
        currencySymbol: user.currencySymbol,
        cardName: user.cardName,
        cardLast4: user.cardLast4,
        maskedCardNumber: user.maskedCardNumber,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/limits
 * @desc    Update card limit, personal limit, alert threshold & billing day
 * @access  Private
 */
router.put(
  '/',
  protect,
  [
    body('cardLimit').optional().isNumeric().withMessage('Credit card limit must be a valid number'),
    body('personalLimit').optional().isNumeric().withMessage('Personal limit must be a valid number'),
    body('alertThreshold')
      .optional()
      .isFloat({ min: 10, max: 100 })
      .withMessage('Alert threshold must be between 10% and 100%'),
    body('billingCycleDay')
      .optional()
      .isInt({ min: 1, max: 28 })
      .withMessage('Billing cycle day must be between 1 and 28'),
    body('currencySymbol').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { cardLimit, personalLimit, alertThreshold, billingCycleDay, currencySymbol, cardName } = req.body;

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (cardLimit !== undefined) user.cardLimit = Math.max(0, Number(cardLimit));
      if (personalLimit !== undefined) user.personalLimit = Math.max(0, Number(personalLimit));
      if (alertThreshold !== undefined) user.alertThreshold = Number(alertThreshold);
      if (billingCycleDay !== undefined) user.billingCycleDay = Number(billingCycleDay);
      if (currencySymbol !== undefined && currencySymbol.trim()) user.currencySymbol = currencySymbol.trim();
      if (cardName !== undefined && cardName.trim()) user.cardName = cardName.trim();

      await user.save();

      res.json({
        success: true,
        message: 'Limits and budget settings updated successfully.',
        data: {
          cardLimit: user.cardLimit,
          personalLimit: user.personalLimit,
          alertThreshold: user.alertThreshold,
          billingCycleDay: user.billingCycleDay,
          currencySymbol: user.currencySymbol,
          cardName: user.cardName,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
