<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/badfeafd-fe65-4101-80d6-2ed62aee4a24" />


## Overview

Focus is a zero-dependency, single-file productivity dashboard that runs in any browser. It pairs a carefully crafted UI with a full Supabase backend — giving you persistent data, user authentication, real-time sync across devices, and a daily email digest, all without a build step or framework.

The design language is warm, minimal, and intentional. No clutter. Every feature earns its place.

---

## Features

### 📋 Tasks
- Create, complete, and delete tasks with one click
- Tag by category — Work, Personal, Health, Urgent
- Filter by tag or status (pending / done)
- Full-text search
- Real-time sync across browser tabs via Supabase Realtime

### 📅 Calendar
- Full monthly calendar view with event markers
- Click any date to add an event
- Mini calendar widget on the dashboard
- Today's schedule shown at a glance

### 📝 Notes
- Two-panel notes editor with live sidebar preview
- Auto-saves after 1.5 seconds of idle typing
- Markdown-style formatting toolbar (bold, italic, headings, lists)
- Persisted per-user in Supabase

### ⏱️ Focus Timer
- Animated Pomodoro ring timer
- Built-in presets: 25/5, 50/10, 90/20, 15/3
- Custom work/break duration
- Session log with time and duration
- Focus sessions stored in the database — track hours over time

### 🔁 Habits
- Weekly habit grid (Mon → Sun)
- One-click day toggle
- Live streak counter
- Syncs with the dashboard summary widget

### 🎯 Goals
- Goal cards with progress bars
- Milestones that auto-update goal progress via a Postgres trigger
- Tag by category with colour coding

### 🔐 Authentication
- Email + password sign-in and sign-up
- Google OAuth (one-click setup)
- Password reset flow
- Password strength meter
- Auto-redirect based on session state

### 📧 Daily Digest
- Personalised morning email at 8am
- Shows today's calendar events, pending tasks, habit streaks
- Streak-at-risk alerts so you never break a chain
- Powered by a Supabase Edge Function + Resend + `pg_cron`

---

## Project Structure

```
focus-app/
├── auth.html                           ← Login / signup page
├── dashboard.html                      ← Main app — all 7 pages in one file
├── supabase-client.js                  ← Reusable typed Supabase helper functions
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql      ← Full DB schema, RLS policies, triggers
│   └── functions/
│       └── daily-digest/
│           └── index.ts                ← Edge Function: daily email digest
├── SETUP.md                            ← Detailed setup guide
└── README.md                           ← This file
```

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/your-username/focus-app.git
cd focus-app
```

### 2. Create a Supabase project

Go to [supabase.com](https://supabase.com) → **New project**. Wait ~2 minutes.

### 3. Run the database migration

In your Supabase dashboard → **SQL Editor**, paste and run:

```
supabase/migrations/001_initial_schema.sql
```

### 4. Add your API keys

In `auth.html` and `dashboard.html`, replace:

```js
const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

Find these values at: **Supabase Dashboard → Project Settings → API**

### 5. Open in your browser

No build step required. Open `auth.html` directly in a browser, or serve with any static host.

```bash
# Quick local server (Python)
python3 -m http.server 3000

# Quick local server (Node)
npx serve .
```

Visit `http://localhost:3000/auth.html`, create an account, and you're in.

---

## Deploying to Production

### Vercel (recommended)

```bash
npm install -g vercel
vercel
```

Or connect your GitHub repo at [vercel.com/new](https://vercel.com/new) — no configuration needed.

### Netlify

Drag and drop the project folder into [app.netlify.com](https://app.netlify.com/drop).

### Cloudflare Pages / GitHub Pages

Push to GitHub and connect via the respective dashboard. No build settings required.

---

## Setting Up Daily Email Digest

### 1. Install Supabase CLI and link your project

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_ID
```

### 2. Set secrets

Get a free API key at [resend.com](https://resend.com) (3,000 emails/month free).

```bash
supabase secrets set RESEND_API_KEY=re_your_key_here
supabase secrets set FROM_EMAIL=focus@yourdomain.com
supabase secrets set APP_URL=https://your-deployed-app.com
```

### 3. Deploy the Edge Function

```bash
supabase functions deploy daily-digest
```

### 4. Schedule with pg_cron

Run this in Supabase SQL Editor to trigger the digest every day at 8am UTC:

```sql
select cron.schedule(
  'daily-digest',
  '0 8 * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/daily-digest',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}',
    body    := '{}'
  );
  $$
);
```

---

## Environment Variables

| Variable | File | Description |
|---|---|---|
| `SUPABASE_URL` | `auth.html`, `dashboard.html` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | `auth.html`, `dashboard.html` | Public anon key — safe to expose |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function + cron only | Secret — never expose client-side |
| `RESEND_API_KEY` | Edge Function | From resend.com |
| `FROM_EMAIL` | Edge Function | Your verified sender address |
| `APP_URL` | Edge Function | Your deployed app URL (for email links) |

---

## Security

- **Row Level Security** is enabled on every table. The database enforces that users can only access their own rows — even if the client-side code were compromised.
- The `SUPABASE_ANON_KEY` is safe to include in client-side code. It is scoped by RLS.
- The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. It is only used in the Edge Function running server-side, and must never appear in `auth.html` or `dashboard.html`.
- Session tokens are stored in `localStorage` and silently refreshed by the Supabase JS client.
- OAuth redirect URIs are locked to your Supabase project domain.

---

## Roadmap

- [ ] Web Push notifications (schema already in place via `push_subscriptions`)
- [ ] Notification preferences settings page
- [ ] Google Calendar two-way sync
- [ ] Weekly analytics view (focus hours chart, task completion rate)
- [ ] CSV / JSON export for tasks and focus sessions
- [ ] Drag-and-drop task reordering
- [ ] Recurring tasks and habits with custom schedules
- [ ] Mobile PWA manifest for home screen install

---

## Contributing

Pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your feature branch — `git checkout -b feature/your-feature`
3. Commit your changes — `git commit -m 'Add your feature'`
4. Push to the branch — `git push origin feature/your-feature`
5. Open a Pull Request

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<div align="center">

Built with care. Designed to help you do your best work.

</div>


###### MADE WITH LOVE BY VINCY x Claude AI #######
