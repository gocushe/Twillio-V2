import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Centralized auth helpers.
 *
 * Each guard returns a NextResponse (the rejection) when auth fails,
 * or null when the request is authorized. Callers do:
 *
 *   const denied = requireAccessKey(req);
 *   if (denied) return denied;
 */

function clean(val) {
  return (val || '').trim().replace(/^"|"$/g, '');
}

let warnedDevAccessKeyFallback = false;

/**
 * Dashboard routes — require x-access-key === APP_ACCESS_KEY.
 */
export function requireAccessKey(req) {
  const configured = clean(process.env.APP_ACCESS_KEY);
  const expected = configured || (process.env.NODE_ENV === 'development' ? 'Alex' : '');
  if (!expected) {
    console.error('APP_ACCESS_KEY environment variable is not defined.');
    return NextResponse.json({ error: 'Server misconfiguration: missing APP_ACCESS_KEY' }, { status: 500 });
  }
  if (!configured && process.env.NODE_ENV === 'development' && !warnedDevAccessKeyFallback) {
    console.warn('APP_ACCESS_KEY is not defined. Using development-only access key "Alex".');
    warnedDevAccessKeyFallback = true;
  }
  const provided = clean(req.headers.get('x-access-key'));
  if (provided !== expected) {
    console.warn('Unauthorized dashboard request — bad or missing x-access-key.');
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }
  return null;
}

/**
 * Cron/keepalive routes — require Authorization: Bearer CRON_SECRET.
 */
export function requireCronSecret(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('CRON_SECRET environment variable is not defined.');
    return NextResponse.json({ error: 'Server misconfiguration: missing CRON_SECRET' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${expected}`) {
    console.warn('Unauthorized cron invocation attempt.');
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }
  return null;
}

/**
 * Reconstruct the public URL Twilio signed. Twilio signs the exact URL it
 * POSTed to (including https + host), which behind Vercel's proxy must be
 * derived from forwarded headers rather than req.url (which may be internal).
 */
export function getPublicUrl(req) {
  const explicit = clean(process.env.PUBLIC_BASE_URL);
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const url = new URL(req.url);
  const base = explicit || `${proto}://${host}`;
  return `${base}${url.pathname}${url.search}`;
}

export function validateTwilioRequest(authToken, signature, url, params = {}) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => `${acc}${key}${params[key] ?? ''}`, url);
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature || '');
  return expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer);
}

/**
 * Twilio webhook — verify X-Twilio-Signature against TWILIO_AUTH_TOKEN.
 * `params` is the parsed application/x-www-form-urlencoded body as an object.
 * Returns null when valid, or a NextResponse rejection when invalid.
 */
export function verifyTwilioSignature(req, params) {
  const authToken = clean(process.env.TWILIO_AUTH_TOKEN);
  if (!authToken) {
    console.error('TWILIO_AUTH_TOKEN environment variable is not defined.');
    return NextResponse.json({ error: 'Server misconfiguration: missing TWILIO_AUTH_TOKEN' }, { status: 500 });
  }
  const signature = req.headers.get('x-twilio-signature');
  if (!signature) {
    console.warn('Twilio webhook missing X-Twilio-Signature header.');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const url = getPublicUrl(req);
  const valid = validateTwilioRequest(authToken, signature, url, params || {});
  if (!valid) {
    console.warn('Twilio webhook signature validation failed.');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
