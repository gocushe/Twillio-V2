# Claude Handoff: Technical Problem Audit — B&A Operations Desk (twillio-v2)

**Date:** 2026-07-02
**Author:** Claude (Fable 5)
**Repo:** `/Users/alexmurphyhome/Desktop/control-centre/business/ba/automations/twilio-birthday/twillio-v2`
**Scope of this pass:** read-only technical analysis of the whole app (~1,700 lines of app/lib code). No source files were modified. Two probe scripts were used against the script sandbox and cleaned up afterward; a leftover local dev server from an earlier session was stopped.

---

## 1. What this app is (so the next AI has context)

B&A Operations Desk — a single-user Next.js 16 (App Router) app deployed on Vercel, backed by Upstash Redis (REST) and the Twilio Node SDK. Three capabilities:

1. **Birthday digest** (the original job) — a daily Vercel cron (`/api/cron`, 15:30 UTC) reads stored client records and texts a consolidated summary of today's birthdays to `ADVISOR_PHONE_NUMBER`. Per project memory and `humanhandoff.md`, **scope is birthdays only**; the "renewals" code in `lib/digest.js` is legacy and should not be built on.
2. **SMS panel** (`/sms`) — type a message, send to one fixed `TARGET_PHONE_NUMBER`, watch a live delivery-status feed.
3. **Automations** (`/scripts`) — save small "pure transform" scripts, run them in a child-process "sandbox." A script may *request* an SMS via a declarative `intent.send_sms`; the system performs the actual send so scripts never see Twilio credentials.

Auth model: dashboard/API routes require `x-access-key: APP_ACCESS_KEY`; cron/keepalive require `Authorization: Bearer CRON_SECRET`; Twilio webhooks are verified by `X-Twilio-Signature`. The front-end passcode gate was removed (commit `696bb9a`); the app now relies solely on the access-key header.

**Current state is healthy on the basics:** `npm audit` is clean (0 vulnerabilities after the dependency remediation earlier today — vitest 4.1.9, next 16.2.10, postcss override 8.5.10), `npm test` passes 80/80, `npm run build` passes, and `/`, `/sms`, `/scripts` return 200 locally.

The working tree has ~35 uncommitted/untracked files (the whole sms/scripts feature set, docs, tests, plus the package.json/lock changes from the audit fix). Nothing here is committed yet.

---

## 2. Findings, by severity

### 🔴 CRITICAL — The script "sandbox" is not a security boundary (arbitrary file read + network + RCE)

**Where:** `scripts/runner/child.mjs`, invoked by `lib/run-script.js`.

**The claim being made:** the child runs with a scrubbed env (`env: {}`) and shadows `process`, `require`, `fetch`, `globalThis`, `Buffer`, etc. to `undefined` inside the user scope. `lib/handoff-template.js` tells script authors the toolkit "exposes NO secrets and NO network."

**Why it fails:** the shadowing is lexical only. User code can mint a fresh function in the real global scope and recover everything:

```js
// Recover the real process object despite the `process=undefined` shadow:
const P = (function(){}).constructor('return process')();

// Recover any core module despite no `require` in an ESM child:
const AsyncFn = (async function(){}).constructor;
const fs = await AsyncFn('return await import("node:fs")')();
```

**Confirmed empirically in this audit:**
- `process` is fully reachable (`process.cwd()` returned the repo path).
- `fetch` is reachable (network exfiltration is possible).
- `await import("node:fs")` works and **read a planted secret file off disk** (`.env.local.probe` containing `SECRET_probe_98765` was exfiltrated through the "sandbox" into the script output).

By the same route, `import("node:child_process")` gives arbitrary command execution, and `import("node:https")`/`fetch` gives outbound exfiltration. The `env: {}` scrub only hides *environment variables* from the child — but on a real deployment the interesting secrets are also **on disk** (`.env.local` locally; bundled files and any readable path on Vercel) and reachable over the **network**, none of which the scrub covers.

**Practical blast radius / mitigating context:** `/scripts` is gated by `APP_ACCESS_KEY`, and this is effectively a single-user app where the owner authors their own scripts, so this is not a wide-open public RCE today. The real-world risk is: (a) the access key leaks or is weak (see the HIGH finding below), or (b) the owner ever pastes in a script from an untrusted source — either yields full file read + network + command execution on the server. The feature's core promise ("isolated," "no secrets, no network") is simply not true, so nobody should trust it as a boundary.

**Direction for a fix (do not just patch the two escapes above — that's whack-a-mole):** a `new Function` / same-process child is fundamentally not isolable in Node. Options, roughly in order of robustness:
- Run the child under a real isolate with no Node builtins — e.g. `isolated-vm`, or a WASM/QuickJS sandbox (`quickjs-emscripten`). This is the only approach that actually holds.
- Or run the child process behind an OS sandbox (seccomp/nsjail/container with no network + read-only, minimal FS) — heavier ops, but defensible.
- If neither is feasible short-term, **stop describing it as a sandbox**, treat scripts as fully trusted owner-only code, and document that plainly so no one relies on the false guarantee.

### 🟠 HIGH — Weak/guessable access key by default; hardcoded "Alex" prefill

**Where:** `app/page.js:8`, `app/sms/page.js:24`, `app/scripts/page.js:7` all default `accessKey` to the literal string `"Alex"`. Git history (`96114d4` "Update access key check to fallback to Alex") suggests `APP_ACCESS_KEY` may actually be set to `Alex` in the deployed environment.

The server side (`lib/auth.js`) is correct — it compares against `process.env.APP_ACCESS_KEY` with no server fallback, and 500s if the env var is missing. So the code is fine; the **operational risk** is that the shared secret is a four-letter first name. Combined with the CRITICAL finding, a guessed access key = RCE. Recommend setting `APP_ACCESS_KEY` (and `CRON_SECRET`) to long random strings in Vercel, and removing the `"Alex"` prefill so the UI doesn't advertise/encourage the weak value.

### 🟡 MODERATE — Non-atomic read-modify-write on SMS status records (lost updates)

**Where:** `lib/sms-runs.js` `updateStatus()` and `linkSid()`. Each does `getRun()` → mutate in JS → `redis.set()`. Twilio fires status callbacks concurrently (e.g. `sent` and `delivered` close together, plus retries), and `/api/sms/status` also races with the inline `updateStatus('twilio_accepted', …)` from `sendTrackedSms`. Two overlapping callbacks can both read the same record and the second `set` clobbers the first — a dropped history entry, or `sid` being overwritten. The terminal-state guard reduces but does not eliminate this.

**Impact:** cosmetic-to-moderate — the status feed can miss a transition or show a stale `sid`. No message is double-sent (that path is separately guarded). **Fix direction:** move the transition into a Lua script / `redis` transaction, or accept the risk and document it since this is a low-volume single-recipient panel.

### 🟡 MODERATE — `getPublicUrl` trusts client-supplied `x-forwarded-host` for webhook signature validation

**Where:** `lib/auth.js` `getPublicUrl()` → used by `verifyTwilioSignature`. When `PUBLIC_BASE_URL` is unset, the signed URL is reconstructed from `x-forwarded-proto`/`x-forwarded-host`/`host` headers. Twilio signature validation hashes the exact URL, so a spoofed host header produces a *mismatch* → validation **fails closed** (rejects), not opens. So this is **not** a signature-forgery hole. The real problems are: (a) legitimate webhooks silently 403 if Vercel's forwarded host ever differs from what Twilio signed, and (b) relying on mutable headers is fragile. **Fix direction:** set `PUBLIC_BASE_URL` explicitly in Vercel (the `.env.local.example` already documents it) and prefer it unconditionally; treat header-derived URLs as a last resort.

### 🟢 LOW — Assorted

- **No `engines` pin / no lockfile-enforced Node version in `package.json`.** CI (`.github/workflows/ci.yml`) uses Node 20; Vercel uses whatever the project setting says. Add `"engines": { "node": ">=20" }` to prevent drift. (Next 16 / React 19 want Node 18.18+/20+.)
- **No ESLint/Prettier config.** For a messaging-critical app, a lint gate in CI would catch a class of mistakes; CI currently runs only `npm test`.
- **CI runs tests but not `npm run build`.** A build break (type/route error) wouldn't be caught until deploy. Add a `build` step to the CI job.
- **`postcss` override is a temporary pin.** Tracked in `docs/claude-dependency-audit-handoff.md` remediation: remove `overrides.postcss` once a stable Next ≥16.3 bundles postcss ≥8.5.10.
- **`sendMessage` (twilio.js) has retry jitter; `sendSms` does not.** Minor inconsistency — the digest path (`sendSms`) retries without jitter, so simultaneous retries could thundering-herd. Very low impact at this volume.
- **Two `next dev` servers were found running** from two different copies of this app on disk (`Old BA Folder/Twillio app/Twillio2` and this canonical `twillio-v2`). Not a code bug, but a housekeeping/confusion risk — see project memory note that `twillio-v2` is now canonical. The stale copy under `Old BA Folder` may be worth archiving so nobody edits/deploys the wrong one.

---

## 3. What is genuinely solid (so you don't "fix" working code)

- **Idempotency is thought through:** digest send uses a durable `digest:sent:<date>` marker plus a short-lived `digest:lock:<date>` NX lock against the double-send race; inbound webhooks dedupe on `MessageSid` (NX); the pipeline engine claims each `(runId, step)` with NX and caches results so replays never re-send.
- **Secret hygiene in logs:** phone numbers are redacted (`redactPhone`/`maskPhone`), and the recipient endpoint only ever returns a masked number.
- **GSM-7 handling** (`lib/sms.js`, `cleanGsm7`) is careful and well-tested (segment counting, extension chars, 120-char cap for the Twilio trial prefix).
- **Leap-year birthday/renewal edge cases** (Feb-29 → Feb-28 observation) are handled and tested.
- **Auth guards are consistently applied** across every route (access key vs cron secret vs Twilio signature, each on the right endpoints).

---

## 4. Next steps — for the next AI

Do these in order; the first is the only urgent one.

1. **Decide the sandbox posture before touching anything else.** Either (a) replace the `new Function` child with a real isolate (`isolated-vm` or `quickjs-emscripten`) and re-verify the escape probes fail, or (b) if the owner accepts "scripts = trusted owner-only code," rewrite `lib/handoff-template.js` and `docs/SMS_AUTOMATION_MODULE.md` to remove the "isolated / no secrets / no network" language and add an explicit "only run scripts you wrote" warning. **Do not** just block `.constructor` / `import()` and call it fixed — that is defeatable. This is a judgment call about product direction, so confirm with the user (see human next steps) before implementing.
2. **Harden secrets:** remove the `"Alex"` default from the three page components; confirm with the user that `APP_ACCESS_KEY` and `CRON_SECRET` in Vercel are long random values, not `Alex`.
3. **Set `PUBLIC_BASE_URL` in Vercel** and make `getPublicUrl` prefer it unconditionally; leave the header fallback only for local dev.
4. **CI hardening:** add `npm run build` to `.github/workflows/ci.yml`, add `"engines": { "node": ">=20" }` to `package.json`.
5. **Optional robustness:** make `updateStatus` atomic (Lua/transaction) if the status feed's occasional dropped transition ever matters in practice.
6. **Regression-test the sandbox:** whatever posture is chosen, add a test under `tests/` that asserts a script attempting `(function(){}).constructor('return process')()` and `import("node:fs")` is either blocked (isolate path) or explicitly acknowledged (trusted path). Right now nothing guards against a future regression.
7. When done, re-run `npm test`, `npm run build`, and smoke-test `/`, `/sms`, `/scripts`. Leave no dev servers or probe files behind.

**Guardrails:** don't commit secrets; don't edit `.env.local`; don't change Twilio send behavior or remove auth guards; avoid broad refactors — this is operations-critical messaging.

## 5. Next steps — for the user / human (Alex)

1. **Sandbox decision (needs your call):** the `/scripts` sandbox does not actually contain scripts — a script can read files, hit the network, and run shell commands on the server. Two realistic paths: **(A) make it truly isolated** (more work, keeps the "run arbitrary scripts safely" promise), or **(B) accept that scripts are trusted code only you write** (little work, but you must never paste in a script from anyone else). Tell the next AI which you want. If you don't use `/scripts` much, (B) is the pragmatic choice.
2. **Check your Vercel secrets:** confirm `APP_ACCESS_KEY` and `CRON_SECRET` are long random strings, not `Alex` / something guessable. If the access key is `Alex`, change it now — combined with the sandbox issue it's the difference between "annoying" and "someone runs code on your server." I can walk you through rotating them.
3. **Set `PUBLIC_BASE_URL`** in Vercel to your deployed URL (e.g. `https://your-app.vercel.app`) so Twilio delivery-status and inbound webhooks validate reliably.
4. **Housekeeping:** there's an *old* second copy of this app under `Desktop/Old BA Folder/Twillio app/Twillio2` that still runs a dev server. To avoid editing/deploying the wrong one, consider archiving it — `twillio-v2` here is the canonical repo.
5. **Nothing is committed yet** — the audit dependency fixes and this doc are sitting as uncommitted changes. Let me know if you want them committed (and on which branch) once you've decided on the sandbox direction.

---

*None of the above changed application behavior. The only files added in this pass are this document; the dependency changes from earlier today (`package.json`, `package-lock.json`) are separate and already documented in `docs/claude-dependency-audit-handoff.md`.*
