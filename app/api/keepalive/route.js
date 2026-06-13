import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { sendSms } from '@/lib/twilio';
import { getVancouverDate } from '@/lib/digest';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  return await handleKeepAlive(req);
}

export async function POST(req) {
  return await handleKeepAlive(req);
}

async function handleKeepAlive(req) {
  const authHeader = req.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.error('CRON_SECRET environment variable is not defined.');
    return NextResponse.json({ error: 'Server misconfiguration: missing CRON_SECRET' }, { status: 500 });
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    console.warn('Unauthorized keepalive invocation attempt.');
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }

  try {
    const activeDate = getVancouverDate();

    if (activeDate > '2026-09-01') {
      console.log(`Keep-alive expired as of ${activeDate}. No-op.`);
      return NextResponse.json({ success: true, expired: true, message: `Keep-alive reminder expired September 1, 2026 (current: ${activeDate}).` });
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
      return NextResponse.json({ success: false, error: dispatchResult.error, dbCount: count }, { status: 500 });
    }

    console.log(`Keep-alive SMS sent. SID: ${dispatchResult.sid}`);
    return NextResponse.json({ success: true, dbCount: count, sid: dispatchResult.sid, status: dispatchResult.status });

  } catch (error) {
    console.error('Keepalive API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
