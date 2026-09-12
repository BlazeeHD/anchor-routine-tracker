# Anchor — daily routine tracker

A time-anchored daily routine tracker: plan your day hour by hour, mark each
block as done or missed, leave optional notes and an end-of-day reflection,
and get rule-based advice on your patterns. Calendar view and a monthly
notes archive included. Built on **Bootstrap 5** (grid, navbar, cards,
modals, dropdown, progress bar) with a small theme layer on top — no build
step, hosted on Cloudflare, backed by Supabase (Postgres + Auth).

## What's in here

```
index.html         redirects to /app or /login depending on session
login.html          sign in / create account (Bootstrap nav-tabs)
app.html             dashboard: date nav, calendar dropdown, timeline,
                      reflection modal, advice
routines.html         manage your recurring time blocks (Bootstrap modal)
archive.html            monthly calendar of past reflections (modal on click)
css/theme.css            re-themes Bootstrap's CSS variables to Anchor's
                          palette, plus the timeline rail & calendar grids
                          (the only pieces Bootstrap has no component for)
js/config.js              <- put your Supabase URL + anon key here
js/supabaseClient.js       creates the shared Supabase client
js/nav.js                   shared Bootstrap navbar + auth guard
js/auth.js                   login/register logic
js/dashboard.js                the main app page logic
js/routines.js                  routine CRUD logic
js/archive.js                    archive page logic
js/advice.js                      rule-based advice engine
supabase/schema.sql                run this once in Supabase
```

Every form in the app — add/edit routine, end-of-day reflection, archive
day detail — is a real Bootstrap `Modal` instance driven from JS
(`new bootstrap.Modal(...)`), not custom popup CSS. The calendar on the
dashboard lives inside a Bootstrap `Dropdown`. The stats bar uses
Bootstrap's `.progress` component. Everything else (grid, cards, forms,
buttons, navbar, alerts) is stock Bootstrap 5 classes, re-themed via CSS
variables in `theme.css` rather than overridden with custom rules.

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

## Categories — using Anchor for work, not just personal routines

Every time block now has a **category**: Personal, Work, Break, Health, or
Other. Use Work for duty hours, Break for lunch/coffee breaks, etc. — the
dashboard shows a colored badge on each block and, once you have more than
one category in use, a row of filter pills above the timeline so you can
isolate just "Work" or just "Break" and see completion stats for that
slice of the day on its own. If your Supabase project predates this
feature, run `supabase/migration_add_category.sql` once to add the column
(existing blocks default to "Personal").

## Timer — live break/duty countdown

A separate **Timer** tab for one-off blocks that aren't part of your daily
routine template — "Lunch at 12:00 for 1 hour," a meeting, an errand.
Pick a label, a start time, and a duration; Anchor shows you the exact
return time, a live countdown, and a progress bar. Ten minutes before
you're due back it fires a heads-up (a browser notification if you grant
permission, plus an in-page banner and a short beep either way), and again
if you go overdue. Today's breaks are logged in a simple history list
below. If your Supabase project predates this feature, run
`supabase/migration_add_breaks.sql` once to add the `breaks` table.

**Note on notifications:** the 10-minutes-before alert is entirely
client-side (no server, no push service), so the browser tab needs to
stay open for it to fire — it won't notify you if the tab or browser is
fully closed. The in-page beep and banner work the same way. This is a
deliberate no-build-step tradeoff; a true background push would need a
service worker and a paid push provider.

## Extending it

- Swap `js/advice.js` for a real AI call (e.g. the Anthropic or OpenAI
  API) later without touching anything else — it's isolated behind
  `generateAdvice(today, recentLogs, routines)`.
- Add push/email reminders via a Supabase Edge Function + cron.
- Add drag-to-reorder or weekly (not just daily) routines by extending
  the `routines` table with a `days_of_week` column.
