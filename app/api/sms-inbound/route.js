import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { verifyTwilioSignature } from '@/lib/auth';
import { optOutKey } from '@/lib/digest';
import { sanitizePhone } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

// Twilio STOP/HELP keyword sets (case-insensitive, matched on the first word).
const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START_KEYWORDS = new Set(['start', 'yes', 'unstop']);
const HELP_KEYWORDS = new Set(['help', 'info']);

const HELP_MESSAGE =
  'B&A Operations alerts. Reply STOP to unsubscribe, START to resubscribe. Msg&data rates may apply.';

function twiml(message) {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

export async function POST(req) {
  // Twilio posts application/x-www-form-urlencoded. Parse once, reuse for both
  // signature validation and handling.
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));

  const denied = verifyTwilioSignature(req, params);
  if (denied) return denied;

  // Idempotency: Twilio retries webhooks on timeout/5xx. Key on MessageSid so a
  // replay is a no-op. SET NX returns null when the SID was already processed.
  const messageSid = params.MessageSid || params.SmsSid;
  if (messageSid) {
    const fresh = await redis.set(`inbound:seen:${messageSid}`, '1', { nx: true, ex: 86400 });
    if (!fresh) {
      console.log(`Inbound webhook replay ignored for ${messageSid}.`);
      return twiml(null);
    }
  }

  const from = sanitizePhone(params.From) || (params.From || '').trim();
  const firstWord = (params.Body || '').trim().toLowerCase().split(/\s+/)[0] || '';

  if (!from) {
    return twiml(null);
  }

  if (STOP_KEYWORDS.has(firstWord)) {
    await redis.set(optOutKey(from), '1');
    console.log(`Opt-out recorded for ${from}.`);
    // Twilio auto-sends its own STOP confirmation; return empty TwiML.
    return twiml(null);
  }

  if (START_KEYWORDS.has(firstWord)) {
    await redis.del(optOutKey(from));
    console.log(`Opt-in (resubscribe) recorded for ${from}.`);
    return twiml(null);
  }

  if (HELP_KEYWORDS.has(firstWord)) {
    return twiml(HELP_MESSAGE);
  }

  // Any other inbound message: acknowledge silently.
  return twiml(null);
}
