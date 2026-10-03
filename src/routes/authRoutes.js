const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// Helper to sign JWT token
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  '/register',
  authLimiter,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long'),
    body('cardLimit').optional().isNumeric().withMessage('Card limit must be a number'),
    body('personalLimit').optional().isNumeric().withMessage('Personal limit must be a number'),
    body('alertThreshold').optional().isNumeric().withMessage('Alert threshold must be a number'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, email, password, cardName, cardLimit, personalLimit, alertThreshold, cardLast4 } = req.body;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'An account with this email address already exists.',
        });
      }

      const user = new User({
        name,
        email,
        password,
        cardName: cardName || 'Primary Credit Card',
        cardLimit: cardLimit !== undefined ? Number(cardLimit) : 100000,
        personalLimit: personalLimit !== undefined ? Number(personalLimit) : 10000,
        alertThreshold: alertThreshold !== undefined ? Number(alertThreshold) : 80,
      });

      if (cardLast4) {
        user.setCardLast4(cardLast4);
      }

      await user.save();

      const token = signToken(user._id);

      res.status(201).json({
        success: true,
        message: 'Account created successfully',
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          cardName: user.cardName,
          cardLast4: user.cardLast4,
          maskedCardNumber: user.maskedCardNumber,
          cardLimit: user.cardLimit,
          personalLimit: user.personalLimit,
          alertThreshold: user.alertThreshold,
          billingCycleDay: user.billingCycleDay,
          currency: user.currency,
          currencySymbol: user.currencySymbol,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and get token
 * @access  Public
 */
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { email, password } = req.body;

      const user = await User.findOne({ email }).select('+password');
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password credentials.',
        });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password credentials.',
        });
      }

      const token = signToken(user._id);

      res.json({
        success: true,
        message: 'Logged in successfully',
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          cardName: user.cardName,
          cardLast4: user.cardLast4,
          maskedCardNumber: user.maskedCardNumber,
          cardLimit: user.cardLimit,
          personalLimit: user.personalLimit,
          alertThreshold: user.alertThreshold,
          billingCycleDay: user.billingCycleDay,
          currency: user.currency,
          currencySymbol: user.currencySymbol,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/auth/me
 * @desc    Get current logged in user profile
 * @access  Private
 */
router.get('/me', protect, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      cardName: req.user.cardName,
      cardLast4: req.user.cardLast4,
      maskedCardNumber: req.user.maskedCardNumber,
      cardLimit: req.user.cardLimit,
      personalLimit: req.user.personalLimit,
      alertThreshold: req.user.alertThreshold,
      billingCycleDay: req.user.billingCycleDay,
      currency: req.user.currency,
      currencySymbol: req.user.currencySymbol,
      createdAt: req.user.createdAt,
    },
  });
});

/**
 * @route   PUT /api/auth/update-password
 * @desc    Update password securely
 * @access  Private
 */
router.put(
  '/update-password',
  protect,
  authLimiter,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { currentPassword, newPassword } = req.body;

      const user = await User.findById(req.user._id).select('+password');

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'The current password you provided is incorrect.',
        });
      }

      user.password = newPassword;
      await user.save();

      const token = signToken(user._id);

      res.json({
        success: true,
        message: 'Password updated successfully.',
        token,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   PUT /api/auth/update-profile
 * @desc    Update user profile details
 * @access  Private
 */
router.put('/update-profile', protect, async (req, res, next) => {
  try {
    const { name, cardName, cardLast4 } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name.trim();
    if (cardName) user.cardName = cardName.trim();
    if (cardLast4) user.setCardLast4(cardLast4);

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        cardName: user.cardName,
        cardLast4: user.cardLast4,
        maskedCardNumber: user.maskedCardNumber,
        cardLimit: user.cardLimit,
        personalLimit: user.personalLimit,
        alertThreshold: user.alertThreshold,
        billingCycleDay: user.billingCycleDay,
        currency: user.currency,
        currencySymbol: user.currencySymbol,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
