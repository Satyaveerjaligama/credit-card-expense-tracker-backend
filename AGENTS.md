# Credit Card Expense Tracker — Backend Context & Architecture (AGENTS.md)

> **Purpose:** This file provides complete architectural context, schemas, API contracts, security practices, and business rules for AI coding assistants working on the **Credit Card Expense Tracker Backend**. Consult this document before writing code, creating endpoints, or modifying existing modules to avoid full-codebase scans.

---

## 1. Project Overview

The **Credit Card Expense Tracker Backend** is a secure REST API built with Node.js and Express 5. It manages personal credit card spending, provides intelligent dual-limit budget tracking, encrypts sensitive financial information at rest, and provides analytics and automated transaction extraction (from bank SMS/notifications).

### Core Features & Value Proposition
- **Dual-Limit Budgeting:** Differentiates between the bank-issued **Card Limit** (e.g., ₹1,00,000) and the user's **Personal Spending Limit** (e.g., ₹10,000/month).
- **Dynamic Warning System:** Tracks cycle progress and triggers proactive alerts when spending crosses the user-defined `alertThreshold` (e.g., 80% = ₹8,000) or exceeds the budget.
- **Billing Cycle Calculation:** Dynamically calculates month cycles based on each user's credit card `billingCycleDay` (1–28).
- **Military-Grade Data Encryption:** Uses **AES-256-GCM** with unique initialization vectors (IV) and authentication tags to encrypt sensitive user data (card last 4 digits, custom transaction notes) in MongoDB.
- **Smart SMS & Notification Parsing:** Extracts amount, merchant, and card details from raw bank SMS strings using regex heuristics with auto-categorization.
- **Financial Analytics:** Provides multi-month spending trends, limit comparison, and category-wise percentage breakdowns.

---

## 2. Tech Stack & Dependencies

- **Runtime:** Node.js (CommonJS: `"type": "commonjs"`)
- **Web Framework:** Express 5 (`express@^5.2.1`)
- **Database & ODM:** MongoDB via Mongoose (`mongoose@^9.10.3`)
- **Security & Cryptography:**
  - Native Node.js `crypto` (`aes-256-gcm` authenticated encryption)
  - `bcryptjs@^3.0.3` (Password hashing with salt rounds = 12)
  - `helmet@^8.3.0` (HTTP security headers)
  - `cors@^2.8.6` (Configured with credentials and allowed origins)
  - `express-rate-limit@^8.7.0` (Separate limits for Auth vs General API)
- **Authentication:** `jsonwebtoken@^9.0.3` (JWT tokens via `Authorization: Bearer <token>` or `cookie-parser`)
- **Validation:** `express-validator@^7.3.2`
- **Logging & Config:** `morgan@^1.12.1`, `dotenv@^18.0.5`

---

## 3. Directory Structure

```text
backend/
├── .env                  # Local environment configuration (git ignored)
├── .env.example          # Environment template
├── package.json          # Dependencies and scripts
├── AGENTS.md             # This context file for AI assistants
└── src/
    ├── server.js         # Express app initialization, middleware, route mounting
    ├── seed.js           # Database seeder with demo user & historical transactions
    ├── config/
    │   ├── db.js         # Mongoose connection logic with fail-safe error handling
    │   └── security.js   # AES-256-GCM encrypt, decrypt, and card masking utilities
    ├── middleware/
    │   ├── auth.js       # JWT verification middleware (`protect`)
    │   ├── errorHandler.js # Centralized error handler (Mongoose & JWT handling)
    │   └── rateLimiter.js# Express rate limiters for auth and general endpoints
    ├── models/
    │   ├── User.js       # User schema, auth hooks, limits, card encryption virtuals
    │   └── Transaction.js# Transaction schema, category enums, notes encryption
    └── routes/
        ├── authRoutes.js        # /api/auth: Register, Login, Me, Update Profile/Password
        ├── transactionRoutes.js # /api/transactions: CRUD, SMS parser, Bulk import
        ├── limitRoutes.js       # /api/limits: Cycle overview, limit & budget settings
        └── analyticsRoutes.js   # /api/analytics: Monthly history & category breakdowns
```

---

## 4. Environment Variables

Defined in `.env` (referenced in [`.env.example`](file:///d:/2026-projects/credit-card-expense-tracker/backend/.env.example)):

| Variable | Required | Default / Format | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | No | `5000` | Port on which the Express server listens. |
| `NODE_ENV` | No | `development` / `production` / `test` | Runtime environment. |
| `MONGODB_URI` | **Yes** | `mongodb+srv://...` | Connection URI for MongoDB database. |
| `JWT_SECRET` | **Yes** | String | Secret key for signing and verifying JWTs. |
| `JWT_EXPIRES_IN`| No | `7d` | Token validity duration. |
| `ENCRYPTION_KEY`| **Yes** | 64-char Hex (32 bytes) | Key for AES-256-GCM encryption.<br>Generate with: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `CLIENT_URL` | No | `http://localhost:3000` | Frontend client origin for CORS. |

---

## 5. Security & Cryptography Implementation

Located in [`src/config/security.js`](file:///d:/2026-projects/credit-card-expense-tracker/backend/src/config/security.js):

- **Algorithm:** `aes-256-gcm`
- **IV Length:** 16 bytes (generated randomly for every encryption call via `crypto.randomBytes(16)`)
- **Auth Tag Length:** 16 bytes (ensures data authenticity and tamper-proofing)
- **Encrypted String Format:** `ivHex:authTagHex:ciphertextHex`
- **Methods:**
  - `encrypt(text)`: Converts plain string to `iv:authTag:ciphertext`. Returns raw value if empty.
  - `decrypt(cipherText)`: Splits parts, checks validity, verifies tag, and decrypts back to utf8. Returns `[Decryption Failed]` or raw string if parsing fails.
  - `maskCardNumber(last4)`: Returns `•••• •••• •••• 1234`.

---

## 6. Database Models & Schema Specifications

### User Model ([`src/models/User.js`](file:///d:/2026-projects/credit-card-expense-tracker/backend/src/models/User.js))

| Field | Type | Options | Description |
| :--- | :--- | :--- | :--- |
| `name` | String | Required, trim, max 60 | User full name |
| `email` | String | Required, unique, lowercase, regex | Email address (unique account ID) |
| `password` | String | Required, min 8, `select: false` | Bcrypt hashed password (cost 12) |
| `cardName` | String | Default: `'Primary Credit Card'` | Display name of the card |
| `cardLast4Encrypted`| String | Default: `null` | AES-256-GCM encrypted last 4 digits |
| `cardLimit` | Number | Default: `100000`, min: `0` | Bank credit limit (e.g. ₹1,00,000) |
| `personalLimit` | Number | Default: `10000`, min: `0` | Monthly personal spending budget cap |
| `alertThreshold` | Number | Default: `80`, min: `10`, max: `100` | Percentage threshold to trigger alert |
| `billingCycleDay` | Number | Default: `1`, min: `1`, max: `28` | Day of month billing cycle restarts |
| `currency` | String | Default: `'INR'` | Currency code |
| `currencySymbol` | String | Default: `'₹'` | Currency symbol used in UI/alerts |

**Virtuals & Helpers:**
- `user.cardLast4` (virtual getter): Decrypts `cardLast4Encrypted`.
- `user.maskedCardNumber` (virtual getter): Returns `•••• •••• •••• <last4>`.
- `user.setCardLast4(last4)`: Cleans digits and encrypts using AES-256-GCM before saving.
- `user.comparePassword(candidate)`: Compares candidate against hashed password using bcrypt.

---

### Transaction Model ([`src/models/Transaction.js`](file:///d:/2026-projects/credit-card-expense-tracker/backend/src/models/Transaction.js))

| Field | Type | Options | Description |
| :--- | :--- | :--- | :--- |
| `user` | ObjectId | Ref: `User`, Required, Index | Belongs to user |
| `amount` | Number | Required, min: `0.01` | Transaction amount |
| `merchant` | String | Required, trim, max 100 | Merchant name or payee |
| `category` | String | Required, Enum, Default: `'Other'` | Valid: `Dining`, `Shopping`, `Groceries`, `Utilities`, `Travel`, `Entertainment`, `Healthcare`, `Education`, `Subscriptions`, `Fuel`, `Other` |
| `date` | Date | Default: `Date.now`, Index | Transaction timestamp |
| `paymentMethod` | String | Default: `'Credit Card'` | Payment mode |
| `notesEncrypted`| String | Default: `null` | AES-256-GCM encrypted notes |
| `source` | String | Enum: `manual`, `sms_sync`, `statement_import` | Origin of entry |
| `billingMonth` | String | Format: `YYYY-MM`, Index | Derived month for rapid grouping |

**Virtuals & Hooks:**
- `pre('save')`: Automatically calculates `billingMonth` from `date` (e.g. `"2026-10"`).
- `transaction.notes` (virtual getter): Decrypts `notesEncrypted`.
- `transaction.setNotes(plainText)`: Encrypts note string with AES-256-GCM.

---

## 7. API Routes & Endpoint Reference

Base URL: `http://localhost:5000/api`

### Health Check
- `GET /api/health` — Returns status, timestamp, and active security features.

### Authentication ([`src/routes/authRoutes.js`](file:///d:/2026-projects/credit-card-expense-tracker/backend/src/routes/authRoutes.js))
Rate limited to 30 requests / 15 minutes (`authLimiter`).

| Method | Endpoint | Access | Body Parameters | Description |
| :--- | :--- | :---: | :--- | :--- |
| `POST` | `/api/auth/register` | Public | `name`, `email`, `password`, `cardName?`, `cardLimit?`, `personalLimit?`, `alertThreshold?`, `cardLast4?` | Creates user, encrypts card, returns JWT & user object |
| `POST` | `/api/auth/login` | Public | `email`, `password` | Verifies credentials, returns JWT & user object |
| `GET` | `/api/auth/me` | Private | *None* | Returns currently authenticated user profile |
| `PUT` | `/api/auth/update-password` | Private | `currentPassword`, `newPassword` | Validates old password and updates to new password |
| `PUT` | `/api/auth/update-profile` | Private | `name?`, `cardName?`, `cardLast4?` | Updates profile fields and re-encrypts card digits |

### Budget & Limit Management ([`src/routes/limitRoutes.js`](file:///d:/2026-projects/credit-card-expense-tracker/backend/src/routes/limitRoutes.js))

| Method | Endpoint | Access | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/limits/overview` | Private | Computes active billing cycle spending based on `billingCycleDay`. Compares against limits. Returns `SAFE`, `WARNING` (if $\ge alertThreshold$), or `EXCEEDED` status along with formatted alert messages. |
| `PUT` | `/api/limits` | Private | Updates `cardLimit`, `personalLimit`, `alertThreshold` (10–100), `billingCycleDay` (1–28), `currencySymbol`, `cardName`. |

### Transactions ([`src/routes/transactionRoutes.js`](file:///d:/2026-projects/credit-card-expense-tracker/backend/src/routes/transactionRoutes.js))

| Method | Endpoint | Access | Query / Body Parameters | Description |
| :--- | :--- | :---: | :--- | :--- |
| `GET` | `/api/transactions` | Private | Queries: `category`, `search`, `month` (`YYYY-MM`), `page` (default 1), `limit` (default 20), `sort` (default `-date`) | Paginated transactions with decrypted notes & total amount for filtered query |
| `POST` | `/api/transactions` | Private | Body: `amount`, `merchant`, `category?`, `date?`, `notes?`, `paymentMethod?`, `source?` | Creates expense. Auto-infers category if missing. Evaluates cycle budget and returns `warningAlert` if threshold crossed |
| `PUT` | `/api/transactions/:id` | Private | Body: `amount?`, `merchant?`, `category?`, `date?`, `notes?`, `paymentMethod?` | Updates transaction. Re-encrypts notes if modified |
| `DELETE`| `/api/transactions/:id`| Private | *None* | Deletes transaction owned by logged-in user |
| `POST` | `/api/transactions/parse-sms` | Private | Body: `smsText` (String), `autoSave?` (Boolean) | Regex parser extracting amount, merchant, last 4 digits, category. Can auto-commit to DB if `autoSave: true` |
| `POST` | `/api/transactions/bulk-import` | Private | Body: `items` (Array of transaction objects) | Batch inserts statement transactions |

### Analytics & Reports ([`src/routes/analyticsRoutes.js`](file:///d:/2026-projects/credit-card-expense-tracker/backend/src/routes/analyticsRoutes.js))

| Method | Endpoint | Access | Query Parameters | Description |
| :--- | :--- | :---: | :--- | :--- |
| `GET` | `/api/analytics/monthly-history` | Private | `months?` (default 6) | Aggregates month-by-month spending, comparisons to limits, max expense, average, over-limit boolean, peak month stats |
| `GET` | `/api/analytics/categories` | Private | `month?` (`YYYY-MM` or all-time) | Category-wise spending totals, transaction counts, and percentage distribution |

---

## 8. Business Logic & Automation Rules

### 1. Billing Cycle Calculation (`getBillingCycleRange`)
Credit card statements rarely align with calendar months (e.g., cycle runs 5th of month to 4th of next month).
- If today $\ge$ `billingCycleDay`:
  - `cycleStart` = `[Current Year, Current Month, billingCycleDay, 00:00:00]`
  - `cycleEnd` = `[Current Year, Current Month + 1, billingCycleDay - 1, 23:59:59]`
- If today $<$ `billingCycleDay`:
  - `cycleStart` = `[Current Year, Current Month - 1, billingCycleDay, 00:00:00]`
  - `cycleEnd` = `[Current Year, Current Month, billingCycleDay - 1, 23:59:59]`

### 2. Auto-Categorization Heuristics (`inferCategory`)
Used in manual transaction entry and SMS parsing if category is not explicitly provided:
- **Dining:** `swiggy`, `zomato`, `starbucks`, `mcdonald`, `kfc`, `cafe`, `restaurant`, `burger`, `pizza`, `food`
- **Shopping:** `amazon`, `flipkart`, `myntra`, `zara`, `h&m`, `clothing`, `store`, `mall`
- **Groceries:** `blinkit`, `zepto`, `instamart`, `bigbasket`, `supermarket`, `grocery`, `mart`
- **Travel:** `uber`, `ola`, `rapido`, `indigo`, `air india`, `irctc`, `makemytrip`, `flight`, `train`
- **Subscriptions:** `netflix`, `spotify`, `prime`, `hotstar`, `apple`, `youtube`, `playstation`, `steam`
- **Fuel:** `petrol`, `diesel`, `fuel`, `shell`, `hpcl`, `bpcl`, `iocl`
- **Entertainment:** `cinema`, `pvr`, `inox`, `movie`, `theatre`, `ticket`, `concert`
- **Utilities:** `electricity`, `water`, `gas`, `broadband`, `wifi`, `jio`, `airtel`, `bescom`
- **Healthcare:** `pharmacy`, `hospital`, `apollo`, `clinic`, `medplus`, `doctor`
- **Education:** `udemy`, `coursera`, `school`, `college`, `tuition`, `book`
- **Fallback:** `Other`

### 3. SMS Bank Notification Parser
The parser handles standard Indian bank formats (HDFC, ICICI, SBI, Axis):
- Regex for amount: `(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)|(?:spent|debited|txn of|paid)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)`
- Merchant regex: `(?:at|to|vpa|info)\s+([A-Za-z0-9\s&'.-]{2,30}?)(?:\s+on|\s+ref|\s+avl|\s+available|\.|\n|$)`
- Card digits regex: `(?:ending|card|xx)\s*(\d{4})`

---

## 9. Development & Operational Commands

```bash
# Start dev server with Node --watch (auto-restart on file changes)
npm run dev

# Start production server
npm start

# Seed database with demo user & realistic 6-month historical transactions
npm run seed
```

### Default Demo Credentials (after seeding)
- **Email:** `demo@example.com`
- **Password:** `Password123!`
- **Card:** HDFC Regalia Gold (`•••• •••• •••• 1234`)
- **Card Limit:** ₹1,00,000 | **Personal Budget:** ₹10,000 | **Alert Threshold:** 80%

---

## 10. Guidelines for AI Assistants Modifying this Codebase

1. **Maintain Encryption Integrity:**
   - **Never** store plain text credit card digits in `User` or unencrypted notes in `Transaction`.
   - Always call `.setCardLast4(digits)` or `.setNotes(text)` when updating those fields.
2. **Centralized Error Handling:**
   - Use `next(error)` in Express routes rather than raw `res.status(500)` calls to let [`src/middleware/errorHandler.js`](file:///d:/2026-projects/credit-card-expense-tracker/backend/src/middleware/errorHandler.js) format errors consistently.
3. **Database Projections:**
   - Remember that `password` has `select: false` on the `User` schema. If performing authentication comparisons, use `.select('+password')`.
4. **Virtuals Serialization:**
   - Both `User` and `Transaction` schemas are configured with `{ toJSON: { virtuals: true }, toObject: { virtuals: true } }`. When sending objects via `res.json()`, virtuals (`cardLast4`, `maskedCardNumber`, `notes`) serialize cleanly.
5. **No Breaking Changes to Response Signatures:**
   - All API endpoints follow a standardized JSON envelope: `{ success: true, data: ..., message: ... }` or `{ success: false, message: ... }`. Maintain this structure for frontend compatibility.
