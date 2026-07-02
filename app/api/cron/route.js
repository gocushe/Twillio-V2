import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireCronSecret } from '@/lib/auth';
import { runDigest } from '@/lib/digest';
import { getDailyRunStatus } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  return await handleCron(req);
}

export async function POST(req) {
  return await handleCron(req);
}

async function handleCron(req) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const schedule = getDailyRunStatus();
    if (schedule.quiet) {
      return NextResponse.json({
        success: false,
        error: 'Quiet hours',
        schedule,
      }, { status: 409 });
    }
    if (!schedule.shouldRun) {
      return NextResponse.json({
        success: true,
        noop: true,
        reason: `Outside daily run window: ${schedule.dailyRunWindow} ${schedule.timeZone}.`,
        schedule,
      });
    }

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
      return NextResponse.json(digestResult, rateLimitResponseOptions(digestResult));
    }

    console.log(`Cron completed for ${digestResult.activeDate}. SMS sent: ${digestResult.smsSent}`);
    return NextResponse.json(digestResult);

  } catch (error) {
    console.error('Cron API Error:', error);
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
