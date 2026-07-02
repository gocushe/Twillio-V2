import { NextResponse } from 'next/server';
import { verifyTwilioSignature } from '@/lib/auth';
import { mapTwilioStatus, updateStatus, runIdForSid } from '@/lib/sms-runs';

export const dynamic = 'force-dynamic';

/**
 * Twilio statusCallback webhook (PUBLIC, signature-verified).
 * Twilio POSTs application/x-www-form-urlencoded with MessageStatus + MessageSid.
 * runId arrives as a query param (we put it on the callback URL).
 */
export async function POST(req) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));

  const denied = verifyTwilioSignature(req, params);
  if (denied) return denied; // 403 on unsigned / bad signature

  const url = new URL(req.url);
  const runId = url.searchParams.get('runId')
    || (params.MessageSid ? await runIdForSid(params.MessageSid) : null);

  const appStatus = mapTwilioStatus(params.MessageStatus);

  // Idempotent + change-only: updateStatus no-ops when the status is unchanged
  // or already terminal, so Twilio's webhook retries are safe.
  if (runId && appStatus) {
    await updateStatus(runId, appStatus, `twilio:${String(params.MessageStatus).toLowerCase()}`);
  }

  return new NextResponse(null, { status: 204 });
}
