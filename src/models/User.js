const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt, maskCardNumber } = require('../config/security');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide your full name'],
      trim: true,
      maxlength: [60, 'Name cannot exceed 60 characters'],
    },
    email: {
      type: String,
      required: [true, 'Please provide a valid email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [8, 'Password must be at least 8 characters long'],
      select: false, // Do not return by default
    },
    cardName: {
      type: String,
      default: 'Primary Credit Card',
      trim: true,
    },
    // Encrypted with AES-256-GCM
    cardLast4Encrypted: {
      type: String,
      default: null,
    },
    // Total Card Limit provided by Bank (e.g., 100,000)
    cardLimit: {
      type: Number,
      required: true,
      default: 100000,
      min: [0, 'Credit card limit cannot be negative'],
    },
    // User's own budget cap for the month (e.g., 10,000)
    personalLimit: {
      type: Number,
      required: true,
      default: 10000,
      min: [0, 'Personal spending limit cannot be negative'],
    },
    // Warning threshold percentage (e.g., 80% means alert at ₹8,000)
    alertThreshold: {
      type: Number,
      default: 80,
      min: [10, 'Alert threshold must be at least 10%'],
      max: [100, 'Alert threshold cannot exceed 100%'],
    },
    // Day of the month the billing cycle begins (1-28)
    billingCycleDay: {
      type: Number,
      default: 1,
      min: 1,
      max: 28,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    currencySymbol: {
      type: String,
      default: '₹',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Encrypt and hash password before saving if modified
userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Virtual getter to retrieve decrypted/masked card last 4 digits
userSchema.virtual('cardLast4').get(function () {
  if (!this.cardLast4Encrypted) return '1234';
  const decrypted = decrypt(this.cardLast4Encrypted);
  return decrypted || '••••';
});

// Virtual getter to retrieve masked card number
userSchema.virtual('maskedCardNumber').get(function () {
  const last4 = this.cardLast4 || '1234';
  return maskCardNumber(last4);
});

// Set cardLast4 helper
userSchema.methods.setCardLast4 = function (last4) {
  if (last4) {
    const cleanLast4 = String(last4).replace(/\D/g, '').slice(-4);
    this.cardLast4Encrypted = encrypt(cleanLast4);
  }
};

module.exports = mongoose.model('User', userSchema);
