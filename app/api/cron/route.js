import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { runDigest } from '@/lib/digest';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  return await handleCron(req);
}

export async function POST(req) {
  return await handleCron(req);
}

async function handleCron(req) {
  const authHeader = req.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.error('CRON_SECRET environment variable is not defined.');
    return NextResponse.json({ error: 'Server misconfiguration: missing CRON_SECRET' }, { status: 500 });
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    console.warn('Unauthorized cron invocation attempt.');
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }

  try {
    const simMode = await redis.get('sim:mode');
    if (simMode === 1 || simMode === '1') {
      console.log('Cron skipped — simulation mode is active.');
      return NextResponse.json({ success: true, noop: true, reason: 'Simulation mode is active. Real cron runs are disabled.' });
    }

    const digestResult = await runDigest();

    if (digestResult.skipped) {
      console.log(`Cron skipped: ${digestResult.reason}`);
      return NextResponse.json(digestResult);
    }

    if (!digestResult.success) {
      console.error(`Cron failed: ${digestResult.error}`);
      return NextResponse.json(digestResult, { status: 500 });
    }

    console.log(`Cron completed for ${digestResult.activeDate}. SMS sent: ${digestResult.smsSent}`);
    return NextResponse.json(digestResult);

  } catch (error) {
    console.error('Cron API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
