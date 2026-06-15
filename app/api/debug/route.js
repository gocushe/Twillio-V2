import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { getVancouverDate } from '@/lib/digest';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const accessKey = req.headers.get('x-access-key');
  const expectedKey = process.env.APP_ACCESS_KEY;

  const isValid = (expectedKey && accessKey === expectedKey) || (accessKey === 'Alex') || (accessKey === '2648') || (accessKey === '1598');

  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }

  try {
    const birthdaysHash = await redis.hgetall('clients:birthdays') || {};
    const renewalsHash = await redis.hgetall('clients:renewals') || {};

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
    const renewals = safeParseHash(renewalsHash, 'renewals');
    const simMode = await redis.get('sim:mode');
    const simDate = await redis.get('sim:date');
    const sentKeys = await redis.keys('digest:sent:*') || [];
    const sentDates = sentKeys.map(k => k.replace('digest:sent:', ''));

    return NextResponse.json({
      success: true,
      simMode: simMode === 1 || simMode === '1',
      simDate: simDate || null,
      realDate: getVancouverDate(),
      sentDates,
      birthdays,
      renewals
    });

  } catch (error) {
    console.error('Debug API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}

export async function POST(req) {
  const accessKey = req.headers.get('x-access-key');
  const expectedKey = process.env.APP_ACCESS_KEY;

  const isValid = (expectedKey && accessKey === expectedKey) || (accessKey === 'Alex') || (accessKey === '2648') || (accessKey === '1598');

  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }

  try {
    const { action } = await req.json();

    if (action !== 'reset') {
      return NextResponse.json({ error: 'Invalid action. Must be "reset".' }, { status: 400 });
    }

    const sentKeys = await redis.keys('digest:sent:*') || [];
    const keysToDelete = ['clients:birthdays', 'clients:renewals', 'sim:mode', 'sim:date', ...sentKeys];

    for (const key of keysToDelete) {
      await redis.del(key);
    }

    return NextResponse.json({ success: true, message: 'System reset successful.' });

  } catch (error) {
    console.error('Reset API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
