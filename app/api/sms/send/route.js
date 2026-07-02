import { NextResponse } from 'next/server';
import { requireAccessKey } from '@/lib/auth';
import { sendTrackedSms } from '@/lib/send-flow';
import { countSmsSegments } from '@/lib/sms';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  let body;
  try {
    ({ body } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'Message body is required.' }, { status: 400 });
  }

  // Surface multi-segment / encoding info so the UI can warn before/after send.
  const segments = countSmsSegments(text);

  const result = await sendTrackedSms(text);

  const payload = {
    runId: result.runId,
    status: result.status,
    sid: result.sid,
    twilioStatus: result.twilioStatus,
    segments,
    rateLimited: result.rateLimited,
    retryAfterSeconds: result.retryAfterSeconds,
    resetAt: result.resetAt,
    limit: result.limit,
    remaining: result.remaining,
    ...(result.error ? { error: result.error } : {}),
  };

  const headers = {};
  if (result.rateLimited) {
    headers['Retry-After'] = String(result.retryAfterSeconds || 60);
    headers['X-RateLimit-Limit'] = String(result.limit || 10);
    headers['X-RateLimit-Remaining'] = String(result.remaining ?? 0);
    if (result.resetAt) headers['X-RateLimit-Reset'] = String(Math.ceil(result.resetAt / 1000));
  }

  return NextResponse.json(payload, { status: result.http, headers });
}
