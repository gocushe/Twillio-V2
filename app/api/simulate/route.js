import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { runDigest, getVancouverDate, addDays } from '@/lib/digest';

export async function POST(req) {
  const accessKey = req.headers.get('x-access-key');
  const expectedKey = process.env.APP_ACCESS_KEY;

  if (!expectedKey) {
    return NextResponse.json({ error: 'Server misconfiguration: missing APP_ACCESS_KEY' }, { status: 500 });
  }

  if (accessKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }

  try {
    let requestDate = null;
    let action = null;
    try {
      const reqBody = await req.json();
      if (reqBody) {
        requestDate = reqBody.date;
        action = reqBody.action;
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
      simDate = currentSimDate ? addDays(currentSimDate, 1) : getVancouverDate();
      await redis.set('sim:date', simDate);
    }

    const digestResult = await runDigest(false);

    return NextResponse.json({ success: true, activeDate: simDate, digestResult });

  } catch (error) {
    console.error('Simulation API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
