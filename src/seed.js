require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Transaction = require('./models/Transaction');

async function seed() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    // Remove existing demo user if exists
    await User.deleteOne({ email: 'demo@example.com' });
    const existingDemoUser = await User.findOne({ email: 'demo@example.com' });
    if (existingDemoUser) {
      await Transaction.deleteMany({ user: existingDemoUser._id });
      await User.deleteOne({ _id: existingDemoUser._id });
    }

    console.log('Creating demo user with 1 Lakh Card Limit and 10 Thousand Personal Limit...');
    const demoUser = new User({
      name: 'Demo User',
      email: 'demo@example.com',
      password: 'Password123!',
      cardName: 'HDFC Regalia Gold Credit Card',
      cardLimit: 100000,     // 1 Lakh
      personalLimit: 10000,  // 10 Thousand
      alertThreshold: 80,    // Warn at 80% (i.e. ₹8,000)
      billingCycleDay: 1,
      currency: 'INR',
      currencySymbol: '₹',
    });

    demoUser.setCardLast4('1234');
    await demoUser.save();
    console.log('Demo user created: demo@example.com / Password123!');

    // Delete past transactions for this user
    await Transaction.deleteMany({ user: demoUser._id });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    // Create current month transactions totaling ~₹8,450 (which is 84.5% of ₹10,000 -> Triggers Warning State!)
    const currentMonthTxns = [
      {
        merchant: 'Swiggy Gourmet',
        amount: 850,
        category: 'Dining',
        date: new Date(currentYear, currentMonth, 2, 20, 15),
        notes: 'Family dinner order',
      },
      {
        merchant: 'Blinkit Instant Mart',
        amount: 620,
        category: 'Groceries',
        date: new Date(currentYear, currentMonth, 3, 9, 30),
        notes: 'Weekly kitchen staples and organic milk',
      },
      {
        merchant: 'Zara Fashion Hub',
        amount: 3490,
        category: 'Shopping',
        date: new Date(currentYear, currentMonth, 4, 17, 45),
        notes: 'Casual cotton shirts',
      },
      {
        merchant: 'Shell Fuel Station',
        amount: 2000,
        category: 'Fuel',
        date: new Date(currentYear, currentMonth, 5, 8, 10),
        notes: 'Full tank premium fuel',
      },
      {
        merchant: 'Netflix Subscription',
        amount: 649,
        category: 'Subscriptions',
        date: new Date(currentYear, currentMonth, 5, 14, 0),
        notes: '4K UHD Monthly Plan',
      },
      {
        merchant: 'Starbucks Coffee',
        amount: 840,
        category: 'Dining',
        date: new Date(currentYear, currentMonth, 6, 16, 20),
        notes: 'Caramel Macchiato & Cinnamon Roll with colleague',
      },
    ];

    // Historical transactions across past 5 months for graphing
    const historicalTxns = [
      // 1 month ago (~₹9,100 spent)
      {
        merchant: 'Amazon Superstore',
        amount: 4500,
        category: 'Shopping',
        date: new Date(currentYear, currentMonth - 1, 12),
        notes: 'Ergonomic chair accessories',
      },
      {
        merchant: 'Zomato Dining',
        amount: 1800,
        category: 'Dining',
        date: new Date(currentYear, currentMonth - 1, 15),
        notes: 'Team lunch',
      },
      {
        merchant: 'Airtel Broadband',
        amount: 1199,
        category: 'Utilities',
        date: new Date(currentYear, currentMonth - 1, 18),
        notes: 'Monthly 300 Mbps bill',
      },
      {
        merchant: 'Apollo Pharmacy',
        amount: 1600,
        category: 'Healthcare',
        date: new Date(currentYear, currentMonth - 1, 22),
        notes: 'Vitamins and routine checkup',
      },

      // 2 months ago (~₹7,650 spent)
      {
        merchant: 'Nature Basket Groceries',
        amount: 3200,
        category: 'Groceries',
        date: new Date(currentYear, currentMonth - 2, 8),
      },
      {
        merchant: 'PVR Inox Cinemas',
        amount: 1450,
        category: 'Entertainment',
        date: new Date(currentYear, currentMonth - 2, 14),
        notes: 'IMAX weekend tickets',
      },
      {
        merchant: 'Uber Rides',
        amount: 1800,
        category: 'Travel',
        date: new Date(currentYear, currentMonth - 2, 20),
      },
      {
        merchant: 'Spotify Family',
        amount: 1200,
        category: 'Subscriptions',
        date: new Date(currentYear, currentMonth - 2, 25),
      },

      // 3 months ago (~₹10,500 spent - Exceeded limit!)
      {
        merchant: 'Flight Tickets - IndiGo',
        amount: 6200,
        category: 'Travel',
        date: new Date(currentYear, currentMonth - 3, 10),
        notes: 'Roundtrip flight tickets',
      },
      {
        merchant: 'Weekend Resort Stay',
        amount: 4300,
        category: 'Travel',
        date: new Date(currentYear, currentMonth - 3, 18),
      },

      // 4 months ago (~₹6,800 spent)
      {
        merchant: 'Myntra Wardrobe',
        amount: 3800,
        category: 'Shopping',
        date: new Date(currentYear, currentMonth - 4, 11),
      },
      {
        merchant: 'Swiggy Feast',
        amount: 1500,
        category: 'Dining',
        date: new Date(currentYear, currentMonth - 4, 19),
      },
      {
        merchant: 'Bescom Electricity',
        amount: 1500,
        category: 'Utilities',
        date: new Date(currentYear, currentMonth - 4, 26),
      },

      // 5 months ago (~₹5,400 spent)
      {
        merchant: 'IKEA Home Living',
        amount: 3200,
        category: 'Shopping',
        date: new Date(currentYear, currentMonth - 5, 5),
      },
      {
        merchant: 'Organic Farmer Market',
        amount: 2200,
        category: 'Groceries',
        date: new Date(currentYear, currentMonth - 5, 17),
      },
    ];

    const allTxnsToInsert = [...currentMonthTxns, ...historicalTxns].map((t) => {
      const doc = new Transaction({
        user: demoUser._id,
        amount: t.amount,
        merchant: t.merchant,
        category: t.category,
        date: t.date,
        source: 'manual',
      });
      if (t.notes) doc.setNotes(t.notes);
      return doc;
    });

    await Transaction.insertMany(allTxnsToInsert);
    console.log(`Inserted ${allTxnsToInsert.length} seed transactions successfully!`);

    const currentTotal = currentMonthTxns.reduce((sum, t) => sum + t.amount, 0);
    console.log(`Current month spending: ₹${currentTotal} / Personal Limit: ₹${demoUser.personalLimit}`);
    console.log(`Threshold alert triggered: ${(currentTotal / demoUser.personalLimit) * 100}% spent.`);

    await mongoose.disconnect();
    console.log('Seed completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

seed();
