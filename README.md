# Anchor — daily routine tracker

A time-anchored daily routine tracker: plan your day hour by hour, mark each
block as done or missed, leave optional notes and an end-of-day reflection,
and get rule-based advice on your patterns. Calendar view included. No
build step — plain HTML/CSS/JS, hosted on Cloudflare Pages, backed by
Supabase (Postgres + Auth).

## What's in here

```
index.html        redirects to /app or /login depending on session
login.html         sign in / create account
app.html            dashboard: date nav, calendar, timeline, feedback, advice
routines.html       manage your recurring time blocks (add/edit/delete)
css/style.css       all styling
js/config.js         <- put your Supabase URL + anon key here
js/supabaseClient.js  creates the shared Supabase client
js/nav.js             shared header + auth guard
js/auth.js             login/register logic
js/dashboard.js        the main app page logic
js/routines.js          routine CRUD logic
js/advice.js             rule-based advice engine
supabase/schema.sql       run this once in Supabase
```

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Once it's ready, open **SQL Editor → New query**, paste the entire
   contents of `supabase/schema.sql`, and run it. This creates the
   `routines`, `routine_logs`, and `daily_feedback` tables with row-level
   security so each user only ever sees their own data.
3. Go to **Authentication → Providers → Email** and make sure Email is
   enabled. For quick local testing you can turn **"Confirm email" off**
   (Authentication → Settings) so `signUp` logs the user straight in —
   turn it back on before real use.
4. Go to **Project Settings → API** and copy your **Project URL** and
   **anon public key**.

## 2. Configure the app

Open `js/config.js` and fill in the two values:

```js
export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

That's the only code change needed to run the app.

## 3. Run it locally

Because the app uses ES modules (`type="module"`), you need to serve it
over HTTP rather than opening the file directly. Any static server works:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed local URL in your browser.

## 4. Deploy to Cloudflare Pages

1. Push this folder to a GitHub/GitLab repo.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages →
   Connect to Git**, select the repo.
3. Build settings: **no build command**, output directory `/` (root).
4. Deploy. Cloudflare Pages will serve the static files directly —
   `js/config.js` ships with your Supabase keys baked in, which is fine
   since the anon key is meant to be public (row-level security is what
   actually protects the data).

## How it works

- **Routines** (`routines.html`) are your recurring plan — a time, a
  title, optional notes, and a duration in minutes. This is the template.
- **Logs** (`routine_logs`) are per-day records: for each routine + date,
  a status of `pending`, `done`, or `missed`, plus an optional free-text
  reason. The dashboard creates/updates these as you tap "Did it" /
  "Missed it" — clicking the same button twice clears it back to pending.
- **Daily feedback** is one optional free-text reflection + mood per day.
- **Stats bar** sums the `duration_minutes` of every done vs. missed block
  for the selected day, so you see actual time kept vs. time lost, not
  just a task count.
- **Calendar dots** are colored by that day's completion ratio (amber =
  high, slate = middling, coral = low), computed from that month's logs.
- **Advice** (`js/advice.js`) is entirely rule-based and runs in the
  browser against your last 7 days of logs — no API key, no external AI
  call, no cost. It looks for your most-missed block, whether mornings or
  evenings slip more, and completion streaks.

## Extending it

- Swap `js/advice.js` for a real AI call (e.g. the Anthropic or OpenAI
  API) later without touching anything else — it's isolated behind
  `generateAdvice(today, recentLogs, routines)`.
- Add push/email reminders via a Supabase Edge Function + cron.
- Add drag-to-reorder or weekly (not just daily) routines by extending
  the `routines` table with a `days_of_week` column.
