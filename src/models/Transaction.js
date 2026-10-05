const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../config/security');

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [0.01, 'Amount must be greater than zero'],
    },
    merchant: {
      type: String,
      required: [true, 'Merchant or payee name is required'],
      trim: true,
      maxlength: [100, 'Merchant name too long'],
    },
    category: {
      type: String,
      required: true,
      enum: [
        'Dining',
        'Shopping',
        'Groceries',
        'Utilities',
        'Travel',
        'Entertainment',
        'Healthcare',
        'Education',
        'Subscriptions',
        'Fuel',
        'Other',
      ],
      default: 'Other',
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    paymentMethod: {
      type: String,
      default: 'Credit Card',
      trim: true,
    },
    // Encrypted notes using AES-256-GCM
    notesEncrypted: {
      type: String,
      default: null,
    },
    source: {
      type: String,
      enum: ['manual', 'sms_sync', 'statement_import'],
      default: 'manual',
    },
    billingMonth: {
      type: String, // Format "YYYY-MM", e.g. "2026-10"
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Auto-derive billingMonth from date if not provided
transactionSchema.pre('save', function () {
  if (this.date) {
    const d = new Date(this.date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    this.billingMonth = `${yyyy}-${mm}`;
  }
});

// Virtual getter to decrypt notes
transactionSchema.virtual('notes').get(function () {
  if (!this.notesEncrypted) return '';
  return decrypt(this.notesEncrypted);
});

// Method to set encrypted notes
transactionSchema.methods.setNotes = function (plainNotes) {
  if (plainNotes) {
    this.notesEncrypted = encrypt(String(plainNotes).trim());
  } else {
    this.notesEncrypted = null;
  }
};

// Compound indexes for high-performance querying and analytics
transactionSchema.index({ user: 1, date: -1 });
transactionSchema.index({ user: 1, billingMonth: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
