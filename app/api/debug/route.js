import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAccessKey } from '@/lib/auth';
import { getBusinessDate } from '@/lib/digest';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  try {
    const birthdaysHash = await redis.hgetall('clients:birthdays') || {};
    const safeParseHash = (hash, type) => {
      const records = [];
      for (const [key, v] of Object.entries(hash)) {
        if (typeof v === 'string') {
          try { records.push(JSON.parse(v)); }
          catch (e) { console.error(`Malformed JSON in debug route clients:${type} key "${key}":`, e); }
        } else if (v) {
          records.push(v);
        }
      }
      return records;
    };

    const birthdays = safeParseHash(birthdaysHash, 'birthdays');
    const simMode = await redis.get('sim:mode');
    const simDate = await redis.get('sim:date');
    const sentKeys = await redis.keys('digest:sent:*') || [];
    const sentDates = sentKeys.map(k => k.replace('digest:sent:', ''));

    return NextResponse.json({
      success: true,
      simMode: simMode === 1 || simMode === '1',
      simDate: simDate || null,
      realDate: getBusinessDate(),
      sentDates,
      birthdays
    });

  } catch (error) {
    console.error('Debug API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}

export async function POST(req) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  try {
    const { action } = await req.json();

    if (action !== 'reset') {
      return NextResponse.json({ error: 'Invalid action. Must be "reset".' }, { status: 400 });
    }

    const sentKeys = await redis.keys('digest:sent:*') || [];
    const keysToDelete = ['clients:birthdays', 'sim:mode', 'sim:date', ...sentKeys];

    for (const key of keysToDelete) {
      await redis.del(key);
    }

    return NextResponse.json({ success: true, message: 'System reset successful.' });

  } catch (error) {
    console.error('Reset API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
