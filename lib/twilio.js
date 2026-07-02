import { reserveSmsSendSlot, isSmsRateLimitError } from './sms-rate-limit.js';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Twilio rate-limit / transient errors worth retrying:
 *  - HTTP 429 (too many requests) / code 20429
 *  - HTTP 5xx (Twilio-side transient failures)
 */
function isRetryable(error) {
  const status = error?.status ?? error?.statusCode;
  const code = error?.code;
  if (status === 429 || code === 20429) return true;
  if (typeof status === 'number' && status >= 500 && status <= 599) return true;
  return false;
}

function clean(val) {
  return (val || '').trim().replace(/^"|"$/g, '');
}

function rateLimitFailure(error) {
  return {
    success: false,
    rateLimited: true,
    code: error.code,
    error: error.message || String(error),
    retryAfterSeconds: error.retryAfterSeconds,
    resetAt: error.resetAt,
    limit: error.limit,
    remaining: error.remaining,
  };
}

async function createTwilioMessage({ accountSid, authToken, to, from, body, statusCallback }) {
  const form = new URLSearchParams({
    To: to,
    From: from,
    Body: body ?? '',
  });
  if (statusCallback) form.set('StatusCallback', statusCallback);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    },
  );

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(payload.message || `Twilio request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.statusCode = response.status;
    error.code = payload.code;
    throw error;
  }

  return payload;
}

/**
 * Generic single-message send used by the SMS panel module. Caller supplies an
 * already-validated E.164 `to`; `from` defaults to TWILIO_FROM_NUMBER. An
 * optional `statusCallback` URL receives delivery webhooks. Retries 429/5xx
 * once with backoff+jitter. Never logs full numbers/credentials.
 */
export async function sendMessage({ to, body, statusCallback } = {}) {
  const accountSid = clean(process.env.TWILIO_ACCOUNT_SID);
  const authToken = clean(process.env.TWILIO_AUTH_TOKEN);
  const fromNumber = clean(process.env.TWILIO_FROM_NUMBER);

  if (!accountSid || !authToken || !fromNumber) {
    const missing = [
      !accountSid && 'TWILIO_ACCOUNT_SID',
      !authToken && 'TWILIO_AUTH_TOKEN',
      !fromNumber && 'TWILIO_FROM_NUMBER',
    ].filter(Boolean).join(', ');
    return { success: false, error: `Missing Twilio environment variables: ${missing}` };
  }
  if (!to) {
    return { success: false, error: 'Missing recipient number.' };
  }

  const params = { to, from: fromNumber, body: body ?? '' };
  if (statusCallback) params.statusCallback = statusCallback;

  try {
    await reserveSmsSendSlot();
  } catch (error) {
    if (isSmsRateLimitError(error)) return rateLimitFailure(error);
    throw error;
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const message = await createTwilioMessage({ accountSid, authToken, ...params });
      return { success: true, sid: message.sid, status: message.status };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS && isRetryable(error)) {
        const jitter = Math.floor(Math.random() * 150);
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
        console.warn(`Twilio sendMessage attempt ${attempt} failed (retryable: ${error.status || error.code}). Backing off ${delay}ms.`);
        await sleep(delay);
        continue;
      }
      console.error('Twilio sendMessage failed:', error?.message || error);
      return { success: false, error: error.message || String(error) };
    }
  }

  return { success: false, error: lastError?.message || String(lastError) };
}

/**
 * Sends a single consolidated SMS to the ADVISOR_PHONE_NUMBER.
 * Retries on 429/5xx with exponential backoff.
 */
export async function sendSms(body) {
  const rawAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const rawAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const rawFromNumber = process.env.TWILIO_FROM_NUMBER;
  const rawAdvisorNumber = process.env.ADVISOR_PHONE_NUMBER;

  if (!rawAccountSid || !rawAuthToken || !rawFromNumber || !rawAdvisorNumber) {
    const errStr = 'Missing Twilio environment variables: ' +
      [
        !rawAccountSid && 'TWILIO_ACCOUNT_SID',
        !rawAuthToken && 'TWILIO_AUTH_TOKEN',
        !rawFromNumber && 'TWILIO_FROM_NUMBER',
        !rawAdvisorNumber && 'ADVISOR_PHONE_NUMBER'
      ].filter(Boolean).join(', ');
    console.error(errStr);
    return { success: false, error: errStr };
  }

  const accountSid = rawAccountSid.trim().replace(/^"|"$/g, '');
  const authToken = rawAuthToken.trim().replace(/^"|"$/g, '');
  const fromNumber = rawFromNumber.trim().replace(/^"|"$/g, '');
  const advisorNumber = rawAdvisorNumber.trim().replace(/^"|"$/g, '');

  // Enforce 120-character hard cap (GSM-7) to accommodate Twilio trial prefix
  const cleanBody = (body || '').slice(0, 120);

  try {
    await reserveSmsSendSlot();
  } catch (error) {
    if (isSmsRateLimitError(error)) return rateLimitFailure(error);
    throw error;
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const message = await createTwilioMessage({
        accountSid,
        authToken,
        body: cleanBody,
        from: fromNumber,
        to: advisorNumber
      });
      return { success: true, sid: message.sid, status: message.status };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS && isRetryable(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`Twilio send attempt ${attempt} failed (retryable: ${error.status || error.code}). Backing off ${delay}ms.`);
        await sleep(delay);
        continue;
      }
      console.error('Twilio SMS dispatch failed:', error);
      return { success: false, error: error.message || String(error) };
    }
  }

  return { success: false, error: lastError?.message || String(lastError) };
}
