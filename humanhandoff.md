# Human Handoff — B&A Operations Desk (Twillio2)

This is the running guide for a person taking over this app. It tells you what
the system does, how to stand it up locally, how to deploy it, what to configure
in Twilio, and how to operate it day-to-day. For deeper detail on the SMS +
automation module, see [`docs/SMS_AUTOMATION_MODULE.md`](docs/SMS_AUTOMATION_MODULE.md).

> **This is the canonical, deployed app.** Of the four folders under
> `BA files/Twillio app/`, **Twillio2** is the live one (only one linked to
> Vercel). `Twillio1`, `Twillioxemail`, `Txtemail` are old/other — ignore them.

---

## 1. What this system does

Three capabilities, one Next.js app:

1. **Birthday digest (original purpose).** A daily cron checks stored client
   records and texts a short consolidated summary of today's birthdays to the
   advisor's phone. **Scope is birthdays only** — there is legacy "renewals" code
   in the repo, but it is not the job of this system. Don't build on it.
2. **SMS panel** (`/sms`). A person types a message and sends it to one fixed
   recipient (`TARGET_PHONE_NUMBER`), then watches a live delivery status feed.
3. **Automations** (`/scripts`). Save small "pure transform" scripts and run them
   in an isolated sandbox. A script can *request* an SMS; the system sends it.

Stack: Next.js 16 (App Router) · Upstash Redis (REST) · Twilio Node SDK ·
deployed on Vercel.

---

## 2. Prerequisites (accounts you need)

| Thing | Why | Where |
|---|---|---|
| **Node.js 20+** | run/build locally | nodejs.org |
| **Twilio account** | sends the SMS | twilio.com — you need Account SID, Auth Token, and a Twilio phone number |
| **Upstash Redis** | stores client records + status | upstash.com — create a Redis DB, copy the **REST** URL + token |
| **Vercel account** | hosting + the daily cron | vercel.com (the project is already linked) |

On a **Twilio trial account** you can only text **verified** numbers — see §6.

---

## 3. Environment variables (the control panel)

Copy `.env.local.example` → `.env.local` and fill every value. These same keys
must also be set in **Vercel → Project → Settings → Environment Variables** for
the deployed app.

| Variable | Used by | Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | all sends | from Twilio console |
| `TWILIO_AUTH_TOKEN` | all sends + webhook signature check | keep secret |
| `TWILIO_FROM_NUMBER` | all sends | your Twilio number, E.164 e.g. `+15551234567` |
| `ADVISOR_PHONE_NUMBER` | birthday digest + keepalive | who gets the daily birthday text (E.164) |
| `TARGET_PHONE_NUMBER` | SMS panel `/sms` | the single fixed recipient (E.164) |
| `UPSTASH_REDIS_REST_URL` | everything | Upstash **REST** URL |
| `UPSTASH_REDIS_REST_TOKEN` | everything | Upstash **REST** token |
| `CRON_SECRET` | `/api/cron`, `/api/keepalive` | any long random string; Vercel sends it automatically (see §7) |
| `APP_ACCESS_KEY` | every dashboard API route | the password that unlocks the UI/API (see the gotcha below) |
| `PUBLIC_BASE_URL` | SMS status callbacks + webhook signature | your deployed URL, e.g. `https://your-app.vercel.app` (no trailing slash needed) |

> ⚠️ **Access-key gotcha (read this).** The dashboard pages send an access key
> that **defaults to `Alex`**. For the UI to talk to the API, `APP_ACCESS_KEY`
> must equal what the page sends. Easiest path: **set `APP_ACCESS_KEY=Alex`**.
> If you want a different key, set `APP_ACCESS_KEY` to it and type that key into
> the "Access key" box on `/sms` and `/scripts`. The key lives in browser memory
> only (never saved to disk).

E.164 = a `+`, country code, then the number, digits only. e.g. `+15551234567`.

---

## 4. Run it locally

```bash
cd "BA files/Twillio app/Twillio2"
npm install
cp .env.local.example .env.local      # then edit .env.local with real values
npm run dev                            # open http://localhost:3000
```

Pages:
- `http://localhost:3000/` — birthday dashboard (records, CSV upload, simulate)
- `http://localhost:3000/sms` — SMS panel
- `http://localhost:3000/scripts` — automations

Run the test suite any time:
```bash
npm test          # 80 unit tests, no network — safe to run anywhere
```

---

## 5. Deploy to Vercel

The project is already linked to Vercel (there's a `.vercel/` folder). To ship:

1. Push the code, **or** run `npx vercel --prod` from this folder.
2. In **Vercel → Settings → Environment Variables**, add all keys from §3
   (Production scope). Set `PUBLIC_BASE_URL` to the production URL Vercel gives
   you.
3. Redeploy so the new env vars take effect.
4. The daily cron jobs in `vercel.json` start running automatically (see §7).

---

## 6. Configure Twilio

Two webhooks point back at this app. Both are already coded — you just wire the
URLs in the Twilio console.

**a) Delivery status (statusCallback).** When `PUBLIC_BASE_URL` is set, every
message sent from `/api/sms/send` automatically tells Twilio to POST delivery
updates to `…/api/sms/status`. No console change is strictly required. (Optional
belt-and-suspenders: set the number's status callback to
`${PUBLIC_BASE_URL}/api/sms/status`.)

**b) Inbound replies / STOP–HELP.** In Twilio Console → your phone number →
**Messaging → "A message comes in"**, set the webhook to:
```
${PUBLIC_BASE_URL}/api/sms-inbound   (HTTP POST)
```
This handles STOP (opt-out, suppresses future sends), START (resubscribe), and
HELP. Both webhooks reject forged requests (`403`) using the Twilio signature.

**c) Verify the recipient (trial accounts only).** Twilio Console → Phone
Numbers → **Verified Caller IDs → Add** → enter `TARGET_PHONE_NUMBER` (and
`ADVISOR_PHONE_NUMBER`) and complete the code. Until verified, trial sends fail.

---

## 7. The automated cron jobs

Defined in `vercel.json`, run by Vercel:

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron` | `30 15 * * *` (daily, 15:30 UTC) | sends the birthday digest to `ADVISOR_PHONE_NUMBER` |
| `/api/keepalive` | `30 15 * * 4` (Thursdays) | a weekly ping so the Upstash DB doesn't idle out |

Both require `Authorization: Bearer <CRON_SECRET>`. **Vercel adds this header
automatically** when `CRON_SECRET` is set in the project env — you don't wire it
by hand. A wrong/missing secret returns `401`, so the endpoints are safe to be
public URLs.

Times are UTC. 15:30 UTC ≈ 7:30 AM Pacific (8:30 during daylight time). All
business date logic inside the app uses **America/Vancouver**, so birthday
matching is correct regardless of the cron's UTC clock.

---

## 8. Day-to-day operation

**Birthday dashboard (`/`):**
- **Records / CSV upload** — upload a CSV of clients (first name, last name,
  phone, birth date). Dates accepted: `YYYY-MM-DD` or `MM/DD/YYYY`. Bad rows are
  rejected with a reason; good rows are de-duplicated by name+phone.
- **Simulate** — pick a date and dry-run the digest without waiting for the cron.
  While simulation mode is on, the real daily cron is paused.
- **History** — log of actions in the current session.

**SMS panel (`/sms`):**
- Type a message, press **Send Message**. The recipient is shown masked
  (`+1•••••1234`) — the full number never reaches the browser.
- The status feed walks `request_sent → twilio_accepted → text_delivered`
  (or shows `failed_to_route` / `failed_delivery`). Over 160 characters warns you
  it's a multi-segment (more expensive) message.

**Automations (`/scripts`):**
- **+ New** starts a script pre-filled with the handoff outline. **Copy Outline**
  puts that template on your clipboard.
- A script implements `run(input, helpers)` and returns data. To send a text it
  returns `intent: { type: 'send_sms', body: '…' }` — **the system sends it**, the
  script itself has no access to Twilio or any secret.
- Run a script via `POST /api/scripts/:id/run`. Scripts that loop forever are
  killed at 3 seconds.

---

## 9. Security model (why it's safe)

- Every dashboard API route requires `x-access-key === APP_ACCESS_KEY` → else
  `401`. Both Twilio webhooks verify the request signature → unsigned/forged =
  `403`.
- No secrets or full phone numbers are ever sent to the browser or written to
  logs (numbers are masked / redacted to last 4).
- User scripts run in a **separate process with a wiped environment** — they
  cannot read `TWILIO_*`, `UPSTASH_*`, `APP_ACCESS_KEY`, or any phone number.
  Side effects only happen through the system, never the script.
- STOP replies opt a number out and suppress future sends (compliance).

---

## 10. Testing & CI

- `npm test` runs 80 unit tests (Vitest). They mock Twilio and Redis, so they
  make **no real calls** and cost nothing.
- `.github/workflows/ci.yml` runs the same tests on every push / pull request.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| UI loads but every action errors `401` | `APP_ACCESS_KEY` ≠ the key the page sends | set `APP_ACCESS_KEY=Alex` or type your key into the Access-key box |
| Message sends but never reaches `text_delivered` | statusCallback can't reach you | set `PUBLIC_BASE_URL` to the real deployed URL; confirm webhook in Twilio |
| Trial send fails immediately | recipient not verified | verify the number in Twilio (see §6c) |
| `/sms` shows recipient as `—` | `TARGET_PHONE_NUMBER` unset/not E.164 | set it to `+1…` |
| Birthday text never arrives | cron secret / env missing on Vercel | confirm `CRON_SECRET`, `TWILIO_*`, `ADVISOR_PHONE_NUMBER` in Vercel env |
| 500 mentioning Redis | Upstash URL/token wrong | re-copy the **REST** URL + token from Upstash |
| Webhook returns `403` | signature mismatch | `PUBLIC_BASE_URL` must exactly match the deployed host (scheme + domain) |

---

## 12. Where things live

```
app/
  page.js                     birthday dashboard UI (/)
  sms/page.js                 SMS panel UI (/sms)
  scripts/page.js             automations UI (/scripts)
  api/cron, api/keepalive     daily/weekly jobs (Bearer CRON_SECRET)
  api/ingest, api/debug, api/simulate   dashboard data routes (x-access-key)
  api/sms-inbound             STOP/HELP webhook (Twilio signature)
  api/sms/*                   send, status webhook, status poll, masked recipient
  api/scripts/*               script CRUD + /:id/run
lib/                          all business logic (auth, twilio, digest, scripts, engine…)
scripts/runner/child.mjs      the sandboxed script runner
tests/                        80 Vitest tests
docs/SMS_AUTOMATION_MODULE.md deeper module reference
.env.local.example            the env contract
vercel.json                   cron schedule
```

## 13. First-run checklist

- [ ] `npm install`
- [ ] Create Upstash Redis DB; copy REST URL + token
- [ ] Gather Twilio SID / Auth Token / from-number
- [ ] Fill `.env.local` (set `APP_ACCESS_KEY=Alex` for the default UI key)
- [ ] `npm test` → 80 passing
- [ ] `npm run dev` → open `/sms`, send a test to your verified number
- [ ] Add the same env vars to Vercel; set `PUBLIC_BASE_URL` to the prod URL
- [ ] Deploy; verify the daily birthday text arrives (or use Simulate to dry-run)
- [ ] Wire the inbound webhook (`/api/sms-inbound`) in Twilio; test STOP/HELP
