const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { getBillingCycleRange } = require('../utils/billingCycle');

/**
 * Category heuristic helper for auto-categorization
 */
function inferCategory(merchantName = '') {
  const m = merchantName.toLowerCase();
  if (/swiggy|zomato|starbucks|mcdonald|kfc|cafe|restaurant|burger|pizza|diner|food/i.test(m)) {
    return 'Dining';
  }
  if (/amazon|flipkart|myntra|zara|h&m|clothing|store|retail|mall/i.test(m)) {
    return 'Shopping';
  }
  if (/blinkit|zepto|instamart|bigbasket|supermarket|grocery|mart|spencer|nature basket/i.test(m)) {
    return 'Groceries';
  }
  if (/uber|ola|rapido|indigo|air india|irctc|makemytrip|cleartrip|flight|train|metro/i.test(m)) {
    return 'Travel';
  }
  if (/netflix|spotify|prime|hotstar|disney|apple|youtube|hulu|playstation|steam/i.test(m)) {
    return 'Subscriptions';
  }
  if (/petrol|diesel|fuel|shell|hpcl|bpcl|iocl/i.test(m)) {
    return 'Fuel';
  }
  if (/cinema|pvr|inox|movie|theatre|ticket|concert/i.test(m)) {
    return 'Entertainment';
  }
  if (/electricity|water|gas|broadband|wifi|jio|airtel|vi|bescom|tneb/i.test(m)) {
    return 'Utilities';
  }
  if (/pharmacy|hospital|apollo|clinic|medplus|doctor|health/i.test(m)) {
    return 'Healthcare';
  }
  if (/udemy|coursera|school|college|tuition|book|university/i.test(m)) {
    return 'Education';
  }
  return 'Other';
}

/**
 * @route   GET /api/transactions
 * @desc    Get all transactions for logged in user with filters & pagination
 * @access  Private
 */
router.get('/', protect, async (req, res, next) => {
  try {
    const { category, search, month, page = 1, limit = 20, sort = '-date' } = req.query;

    const query = { user: req.user._id };

    if (category && category !== 'All') {
      query.category = category;
    }

    if (search && search.trim()) {
      query.merchant = { $regex: search.trim(), $options: 'i' };
    }

    if (month && month.trim()) {
      query.billingMonth = month.trim(); // e.g. "2026-10"
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    const [transactions, totalCount] = await Promise.all([
      Transaction.find(query).sort(sort).skip(skip).limit(limitNum),
      Transaction.countDocuments(query),
    ]);

    // Format transactions with decrypted notes
    const formattedTransactions = transactions.map((t) => ({
      _id: t._id,
      amount: t.amount,
      merchant: t.merchant,
      category: t.category,
      date: t.date,
      paymentMethod: t.paymentMethod,
      source: t.source,
      billingMonth: t.billingMonth,
      notes: t.notes, // Virtual decrypted getter
      createdAt: t.createdAt,
    }));

    // Aggregate total sum for the query filter
    const totalAmountAgg = await Transaction.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const filteredTotalAmount = totalAmountAgg.length > 0 ? totalAmountAgg[0].total : 0;

    res.json({
      success: true,
      data: formattedTransactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
      filteredTotalAmount,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/transactions
 * @desc    Add a new credit card expense
 * @access  Private
 */
router.post(
  '/',
  protect,
  [
    body('amount').isFloat({ min: 0.01 }).withMessage('Valid transaction amount is required'),
    body('merchant').trim().notEmpty().withMessage('Merchant name is required'),
    body('category').optional().isString(),
    body('date').optional().isISO8601().withMessage('Valid date required'),
    body('notes').optional().isString(),
    body('paymentMethod').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { amount, merchant, category, date, notes, paymentMethod, source } = req.body;

      const finalCategory = category || inferCategory(merchant);

      const transaction = new Transaction({
        user: req.user._id,
        amount: Number(amount),
        merchant: merchant.trim(),
        category: finalCategory,
        date: date ? new Date(date) : new Date(),
        paymentMethod: paymentMethod || 'Credit Card',
        source: source || 'manual',
      });

      if (notes) {
        transaction.setNotes(notes);
      }

      await transaction.save();

      // Check current cycle spending to see if limit is reached or warning threshold crossed
      const { cycleStart, cycleEnd } = getBillingCycleRange(req.user.billingCycleDay);

      const totalSpentAgg = await Transaction.aggregate([
        {
          $match: {
            user: req.user._id,
            date: { $gte: cycleStart, $lte: cycleEnd },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);

      const currentCycleSpent = totalSpentAgg.length > 0 ? totalSpentAgg[0].total : transaction.amount;
      const personalLimit = req.user.personalLimit;
      const alertThreshold = req.user.alertThreshold || 80;
      const thresholdAmount = (personalLimit * alertThreshold) / 100;

      let warningAlert = null;
      if (currentCycleSpent > personalLimit) {
        warningAlert = {
          type: 'EXCEEDED',
          message: `🚨 Warning: You have exceeded your personal limit of ${req.user.currencySymbol}${personalLimit.toLocaleString()}! Current spent: ${req.user.currencySymbol}${currentCycleSpent.toLocaleString()}`,
        };
      } else if (currentCycleSpent >= thresholdAmount) {
        const remaining = (personalLimit - currentCycleSpent).toFixed(2);
        warningAlert = {
          type: 'WARNING',
          message: `⚠️ Attention: You have reached ${((currentCycleSpent / personalLimit) * 100).toFixed(1)}% of your personal limit. Remaining budget: ${req.user.currencySymbol}${Number(remaining).toLocaleString()}`,
        };
      }

      res.status(201).json({
        success: true,
        message: 'Expense added successfully',
        data: {
          _id: transaction._id,
          amount: transaction.amount,
          merchant: transaction.merchant,
          category: transaction.category,
          date: transaction.date,
          paymentMethod: transaction.paymentMethod,
          source: transaction.source,
          billingMonth: transaction.billingMonth,
          notes: transaction.notes,
        },
        warningAlert,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   PUT /api/transactions/:id
 * @desc    Update a transaction
 * @access  Private
 */
router.put('/:id', protect, async (req, res, next) => {
  try {
    const { amount, merchant, category, date, notes, paymentMethod } = req.body;

    const transaction = await Transaction.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (amount !== undefined) transaction.amount = Number(amount);
    if (merchant !== undefined) transaction.merchant = merchant.trim();
    if (category !== undefined) transaction.category = category;
    if (date !== undefined) transaction.date = new Date(date);
    if (paymentMethod !== undefined) transaction.paymentMethod = paymentMethod;
    if (notes !== undefined) transaction.setNotes(notes);

    await transaction.save();

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: {
        _id: transaction._id,
        amount: transaction.amount,
        merchant: transaction.merchant,
        category: transaction.category,
        date: transaction.date,
        paymentMethod: transaction.paymentMethod,
        source: transaction.source,
        billingMonth: transaction.billingMonth,
        notes: transaction.notes,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   DELETE /api/transactions/:id
 * @desc    Delete a transaction
 * @access  Private
 */
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const transaction = await Transaction.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    res.json({
      success: true,
      message: 'Transaction deleted successfully',
      id: req.params.id,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/transactions/parse-sms
 * @desc    Parse bank SMS / notification text to extract spending transaction
 * @access  Private
 */
router.post('/parse-sms', protect, async (req, res, next) => {
  try {
    const { smsText, autoSave = false } = req.body;

    if (!smsText || typeof smsText !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide valid SMS or notification text to parse.',
      });
    }

    // Typical Bank SMS formats:
    // "Alert: INR 1,450.00 spent on HDFC Bank Card ending 1234 at Swiggy on 02-OCT-26. Available limit..."
    // "Rs. 499.00 spent on your ICICI Bank Credit Card XX1234 at Amazon on 01-Oct-26."
    // "Txn of INR 2500.50 done on SBI Card ending 9921 at Shell Fuel Station on 28-SEP-26"
    // "Spent Rs 320 at Starbucks using Axis Bank Card 02/10/2026"
    const text = smsText.trim();

    // 1. Extract Amount
    let amount = null;
    const amountRegex = /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)|(?:spent|debited|txn of|paid)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i;
    const amountMatch = text.match(amountRegex);

    if (amountMatch) {
      const rawNum = (amountMatch[1] || amountMatch[2] || '').replace(/,/g, '');
      if (rawNum && !isNaN(rawNum)) {
        amount = parseFloat(rawNum);
      }
    }

    // 2. Extract Merchant
    let merchant = 'Unknown Merchant';
    const merchantRegex = /(?:at|to|vpa|info)\s+([A-Za-z0-9\s&'.-]{2,30}?)(?:\s+on|\s+ref|\s+avl|\s+available|\.|\n|$)/i;
    const merchantMatch = text.match(merchantRegex);
    if (merchantMatch && merchantMatch[1]) {
      merchant = merchantMatch[1].trim().replace(/\s{2,}/g, ' ');
    }

    // 3. Extract Card Last 4
    let cardLast4 = null;
    const cardRegex = /(?:ending|card|xx)\s*(\d{4})/i;
    const cardMatch = text.match(cardRegex);
    if (cardMatch && cardMatch[1]) {
      cardLast4 = cardMatch[1];
    }

    // 4. Infer Category
    const category = inferCategory(merchant);

    const parsedResult = {
      amount: amount || 0,
      merchant: merchant !== 'Unknown Merchant' ? merchant : 'Card Payment',
      category,
      date: new Date(),
      cardLast4,
      originalText: text,
      confidence: amount ? 'HIGH' : 'LOW',
    };

    // If autoSave flag is passed, directly record into DB
    if (autoSave && amount) {
      const newTxn = new Transaction({
        user: req.user._id,
        amount: parsedResult.amount,
        merchant: parsedResult.merchant,
        category: parsedResult.category,
        date: parsedResult.date,
        source: 'sms_sync',
      });
      newTxn.setNotes(`Auto-extracted from bank notification: "${text.slice(0, 100)}..."`);
      await newTxn.save();

      return res.json({
        success: true,
        message: 'Transaction successfully extracted from SMS and saved!',
        data: newTxn,
        parsed: parsedResult,
      });
    }

    res.json({
      success: true,
      message: amount ? 'SMS parsed successfully' : 'Could not detect amount with certainty',
      parsed: parsedResult,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/transactions/bulk-import
 * @desc    Bulk import transactions (e.g. from bank statement CSV)
 * @access  Private
 */
router.post('/bulk-import', protect, async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Array of items required' });
    }

    const docs = items.map((item) => {
      const merchant = (item.merchant || 'Expense').trim();
      const txnDate = item.date ? new Date(item.date) : new Date();
      const yyyy = txnDate.getFullYear();
      const mm = String(txnDate.getMonth() + 1).padStart(2, '0');
      const billingMonth = `${yyyy}-${mm}`;

      const txn = new Transaction({
        user: req.user._id,
        amount: Number(item.amount) || 0,
        merchant,
        category: item.category || inferCategory(merchant),
        date: txnDate,
        billingMonth,
        paymentMethod: item.paymentMethod || 'Credit Card',
        source: 'statement_import',
      });
      if (item.notes) txn.setNotes(item.notes);
      return txn;
    });

    const inserted = await Transaction.insertMany(docs);

    res.status(201).json({
      success: true,
      message: `Successfully imported ${inserted.length} transactions.`,
      count: inserted.length,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
