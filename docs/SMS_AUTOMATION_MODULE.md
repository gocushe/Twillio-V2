# SMS Panel + Automation Runner + Status Logger

An internal module added to the B&A Operations app (Next.js App Router, Upstash
Redis, Twilio SDK). All dashboard routes are gated by `x-access-key ===
APP_ACCESS_KEY`; the Twilio webhook is gated by signature verification.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/sms` | page | in-memory key | Single-recipient composer + live status feed |
| `/scripts` | page | in-memory key | Script CRUD + Copy Outline |
| `/api/sms/recipient` | GET | x-access-key | Masked `TARGET_PHONE_NUMBER` only |
| `/api/sms/send` | POST | x-access-key | Send to target; returns `runId` + segment info |
| `/api/sms/status` | POST | **Twilio signature** | statusCallback webhook (public) |
| `/api/sms/status/:runId` | GET | x-access-key | Poll status + history |
| `/api/scripts` | GET/POST | x-access-key | List / create |
| `/api/scripts/:id` | GET/PUT/DELETE | x-access-key | Read / update / delete |
| `/api/scripts/:id/run` | POST | x-access-key | Execute pipeline (isolated) |

## Status lifecycle

`draft → request_sent → twilio_accepted → text_delivered`
(or `failed_to_route` on SDK throw, `failed_delivery` on carrier failure).
Webhook updates are idempotent and never move a run out of a terminal state.

## Environment

Copy `.env.local.example` → `.env.local` and fill in. New keys for this module:

```
TARGET_PHONE_NUMBER=+1XXXXXXXXXX   # single fixed recipient (E.164)
PUBLIC_BASE_URL=https://<your-app>.vercel.app
```

`TWILIO_*`, `UPSTASH_*`, `APP_ACCESS_KEY` are reused from the existing app.

## Twilio statusCallback setup

Delivery receipts arrive via webhook. Point Twilio at this app:

1. **Per-message (already wired):** when `PUBLIC_BASE_URL` is set, `/api/sms/send`
   attaches `statusCallback = ${PUBLIC_BASE_URL}/api/sms/status?runId=<runId>`
   to every message automatically. No console change strictly required.
2. **Optional fallback (Messaging Service or number):** in the Twilio Console set
   the number's / Messaging Service's status callback URL to
   `${PUBLIC_BASE_URL}/api/sms/status`. (The per-message URL takes precedence.)

The webhook verifies `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN`; unsigned or
tampered requests get `403`. Signature validation uses the full public URL —
make sure `PUBLIC_BASE_URL` matches the deployed host exactly (scheme + domain).

## Verifying the recipient on a Twilio trial account

Trial accounts can only send to **verified** numbers:

1. Twilio Console → **Phone Numbers → Verified Caller IDs → Add a number**.
2. Enter `TARGET_PHONE_NUMBER`, complete the call/SMS verification code.
3. Trial messages are prefixed with "Sent from your Twilio trial account" — this
   is why `lib/twilio.js` keeps the digest body under a hard cap.

## Phase 1 manual test gate

1. Send a message from `/sms` to the verified target → feed walks
   `request_sent → twilio_accepted → text_delivered`.
2. Temporarily set a wrong `TWILIO_AUTH_TOKEN` → send → `failed_to_route` surfaces
   immediately (`502`).
3. `curl -X POST $PUBLIC_BASE_URL/api/sms/status` with no signature → `403`.

## Script execution model (Phase 3)

Scripts are **pure transforms** implementing `run(input, helpers)` against the
handoff contract (see Copy Outline). They run in a **child process with a
scrubbed env** — no `TWILIO_*`, `UPSTASH_*`, `APP_ACCESS_KEY`, or
`TARGET_PHONE_NUMBER` is reachable. A script never performs side effects; it
returns a declarative `intent` (e.g. `{ type:'send_sms', body }`) and the
**system** executes it via the same Phase-1 send path. Each `(runId, step)` runs
at most once (Redis NX guard); overruns are SIGKILLed at a 3s hard timeout.

> Note: the runner spawns `node` per execution. This is intended for the local /
> low-volume internal tool described here. For high-throughput serverless use,
> move execution to a dedicated worker.
