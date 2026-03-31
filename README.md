# RestaurantIQ SaaS Platform

AI-powered weekly digest platform for restaurants. Organisations register, connect their Google Maps listing, and receive a weekly email with rating analysis, unaddressed issues, action items, and competitor alerts.

---

## Architecture

```
restaurant-saas/
├── server/
│   ├── index.js              ← Main HTTP server + static serving
│   ├── auth/auth.js          ← Session-based auth middleware
│   ├── db/store.js           ← File-based JSON database (no external DB)
│   ├── db/data/              ← Auto-created: orgs.json, sessions.json, digests.json
│   ├── digest/
│   │   ├── insights.js       ← Google Maps + Claude AI pipeline
│   │   └── mailer.js         ← Weekly email HTML builder + sender
│   ├── routes/routes.js      ← All API route handlers
│   └── scheduler/scheduler.js← Weekly cron job (every Monday 8AM)
└── public/
    ├── index.html            ← Landing / marketing page
    ├── login.html            ← Login page
    ├── register.html         ← 3-step onboarding
    └── dashboard.html        ← Org dashboard (overview, digests, settings)
```

---

## Setup

### 1. Install dependencies
```bash
cd restaurant-saas
npm install
```

### 2. Set environment variables
Create a `.env` file or export these before running:

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx
export GOOGLE_MAPS_API_KEY=AIzaSyxxxxxxxxxxxxxxxx
export EMAIL_FROM=your@gmail.com
export EMAIL_PASS=your-gmail-app-password        # Gmail App Password (not login password)
export EMAIL_HOST=smtp.gmail.com
export EMAIL_PORT=587
```

Or edit directly in `server/digest/insights.js` lines 5-6 (for local dev only).

### 3. Run
```bash
node server/index.js
```

Open: http://localhost:3000

---

## User Flow

```
1. Organisation lands on /
2. Clicks "Get Started" → /register (3-step form)
   Step 1: Name, Email, Password
   Step 2: Restaurant name + location
   Step 3: Choose plan + digest day
3. Redirected to /dashboard
4. Dashboard shows:
   - Current rating, review count, trend
   - Latest digest summary
   - Issue list + action items
   - "Generate Digest Now" button (on-demand)
5. Every Monday 8AM: scheduler auto-runs for all subscribed orgs
   - Fetches fresh Google Maps data
   - Claude analyzes reviews → insights
   - Beautiful HTML email sent to org's email
   - Digest saved to history
```

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register new org |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET  | /api/auth/me | Get current org |
| GET  | /api/org/digest | Get digest history |
| POST | /api/org/digest/generate | Generate digest on demand |
| GET  | /api/org/profile | Get org profile |
| POST | /api/org/profile | Update org profile |
| POST | /api/places/search | Search Google Maps place |
| POST | /api/admin/run-digest | Trigger digest for all orgs |

---

## Weekly Digest Email Contains

1. **Executive Summary** — 2-3 sentence plain English overview
2. **Rating Overview** — Current rating, total reviews, trend (improving/stable/declining)
3. **Unaddressed Issues** — Repeated complaints not responded to by management
4. **Action Items** — Prioritised (high/medium/low) specific actions to take
5. **What Customers Love** — Positive patterns to maintain
6. **Recent Reviews** — Top 3 latest customer reviews
7. **Competitor Alert** — If customers mentioned competitors in reviews

---

## Gmail Setup (for email sending)

1. Enable 2FA on your Gmail account
2. Go to Google Account → Security → App Passwords
3. Create an app password for "Mail"
4. Use that 16-digit password as `EMAIL_PASS`

---

## Security Note

⚠️ Your API keys in `server.js` from the original app are exposed. Always use environment variables:
```bash
export ANTHROPIC_API_KEY=your_key
export GOOGLE_MAPS_API_KEY=your_key
```

Never commit API keys to git. Add `.env` and `server/db/data/` to `.gitignore`.
