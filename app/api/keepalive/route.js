import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireCronSecret } from '@/lib/auth';
import { sendSms } from '@/lib/twilio';
import { getBusinessDate, isOptedOut } from '@/lib/digest';
import { getQuietHoursStatus } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  return await handleKeepAlive(req);
}

export async function POST(req) {
  return await handleKeepAlive(req);
}

async function handleKeepAlive(req) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const quietHours = getQuietHoursStatus();
    if (quietHours.quiet) {
      return NextResponse.json({
        success: false,
        error: 'Quiet hours',
        schedule: quietHours,
      }, { status: 409 });
    }

    const activeDate = getBusinessDate();

    if (activeDate > '2026-09-01') {
      console.log(`Keep-alive expired as of ${activeDate}. No-op.`);
      return NextResponse.json({ success: true, expired: true, message: `Keep-alive reminder expired September 1, 2026 (current: ${activeDate}).` });
    }

    if (await isOptedOut(process.env.ADVISOR_PHONE_NUMBER)) {
      console.log('Keep-alive suppressed — advisor number is opted out (STOP).');
      return NextResponse.json({ success: true, suppressed: true, reason: 'Recipient opted out (STOP).' });
    }

    const count = await redis.incr('system:keepalive_count');
    console.log(`Keep-alive count: ${count}`);

    let smsBody = "Hi Alex, this is your weekly B&A reminder to use the operations dashboard to keep your Upstash Redis database active!";

    if (activeDate >= '2026-08-18' && activeDate <= '2026-09-01') {
      smsBody += " This text/ maintenance function is going to delete itself soon.";
    }

    const dispatchResult = await sendSms(smsBody);

    if (!dispatchResult.success) {
      console.error(`Keep-alive SMS failed: ${dispatchResult.error}`);
      const payload = {
        success: false,
        error: dispatchResult.error,
        dbCount: count,
        rateLimited: dispatchResult.rateLimited,
        retryAfterSeconds: dispatchResult.retryAfterSeconds,
        resetAt: dispatchResult.resetAt,
        limit: dispatchResult.limit,
        remaining: dispatchResult.remaining,
      };
      return NextResponse.json(payload, rateLimitResponseOptions(dispatchResult));
    }

    console.log(`Keep-alive SMS sent. SID: ${dispatchResult.sid}`);
    return NextResponse.json({ success: true, dbCount: count, sid: dispatchResult.sid, status: dispatchResult.status });

  } catch (error) {
    console.error('Keepalive API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}

function rateLimitResponseOptions(result) {
  if (!result.rateLimited) return { status: 500 };
  const headers = {
    'Retry-After': String(result.retryAfterSeconds || 60),
    'X-RateLimit-Limit': String(result.limit || 10),
    'X-RateLimit-Remaining': String(result.remaining ?? 0),
  };
  if (result.resetAt) headers['X-RateLimit-Reset'] = String(Math.ceil(result.resetAt / 1000));
  return { status: 429, headers };
}
