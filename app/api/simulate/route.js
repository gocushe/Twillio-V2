import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAccessKey } from '@/lib/auth';
import { runDigest, getBusinessDate, addDays } from '@/lib/digest';

export async function POST(req) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  try {
    let requestDate = null;
    let action = null;
    let dryRun = false;
    try {
      const reqBody = await req.json();
      if (reqBody) {
        requestDate = reqBody.date;
        action = reqBody.action;
        dryRun = reqBody.dryRun === true || reqBody.mode === 'test';
      }
    } catch (e) {
      // Empty body — fallback to auto-increment
    }

    if (action === 'stop') {
      await redis.del('sim:mode');
      await redis.del('sim:date');
      return NextResponse.json({ success: true, message: 'Simulation mode deactivated. Restored real-time cron execution.' });
    }

    await redis.set('sim:mode', 1);

    let simDate;
    if (requestDate) {
      simDate = requestDate;
      await redis.set('sim:date', simDate);
    } else {
      let currentSimDate = await redis.get('sim:date');
      simDate = currentSimDate ? addDays(currentSimDate, 1) : getBusinessDate();
      await redis.set('sim:date', simDate);
    }

    const digestResult = await runDigest(Boolean(requestDate), { dryRun });

    return NextResponse.json({ success: true, activeDate: simDate, digestResult });

  } catch (error) {
    console.error('Simulation API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
