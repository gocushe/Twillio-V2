import { randomUUID } from 'crypto';
import { sendMessage } from './twilio.js';
import { isE164 } from './phone.js';
import { countSmsSegments } from './sms.js';
import { createRun, updateStatus, linkSid } from './sms-runs.js';

/**
 * Single source of truth for "send one SMS to the fixed TARGET_PHONE_NUMBER and
 * track its status lifecycle". Used by POST /api/sms/send AND by the Phase-3
 * execution engine when a script returns intent.send_sms — so user scripts
 * never see Twilio credentials or the target number.
 *
 * Returns:
 *   { ok, http, runId, status, sid?, twilioStatus?, segments, error? }
 */
export async function sendTrackedSms(rawBody) {
  const body = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (!body) {
    return { ok: false, http: 400, error: 'Message body is required.' };
  }

  const to = (process.env.TARGET_PHONE_NUMBER || process.env.ADVISOR_PHONE_NUMBER || '').trim();
  const from = (process.env.TWILIO_FROM_NUMBER || '').trim();
  if (!isE164(to) || !isE164(from)) {
    return { ok: false, http: 500, error: 'Server misconfiguration: TARGET_PHONE_NUMBER or ADVISOR_PHONE_NUMBER, plus TWILIO_FROM_NUMBER, must be E.164.' };
  }

  const segments = countSmsSegments(body);
  const runId = randomUUID();
  await createRun(runId, body);

  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const statusCallback = base ? `${base}/api/sms/status?runId=${runId}` : undefined;

  const result = await sendMessage({ to, body, statusCallback });

  if (!result.success) {
    await updateStatus(runId, 'failed_to_route', result.error);
    return {
      ok: false,
      http: result.rateLimited ? 429 : 502,
      runId,
      status: 'failed_to_route',
      error: result.error,
      segments,
      ...(result.rateLimited ? {
        rateLimited: true,
        retryAfterSeconds: result.retryAfterSeconds,
        resetAt: result.resetAt,
        limit: result.limit,
        remaining: result.remaining,
      } : {}),
    };
  }

  await linkSid(result.sid, runId);
  await updateStatus(runId, 'twilio_accepted', result.status, { sid: result.sid });
  return { ok: true, http: 202, runId, status: 'twilio_accepted', sid: result.sid, twilioStatus: result.status, segments };
}
