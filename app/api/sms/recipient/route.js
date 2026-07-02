import { NextResponse } from 'next/server';
import { requireAccessKey } from '@/lib/auth';
import { maskPhone, isE164 } from '@/lib/phone';

export const dynamic = 'force-dynamic';

/**
 * Returns ONLY the masked recipient. The full configured phone number never
 * leaves the server.
 */
export async function GET(req) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  const target = (process.env.TARGET_PHONE_NUMBER || process.env.ADVISOR_PHONE_NUMBER || '').trim();
  if (!isE164(target)) {
    return NextResponse.json({ error: 'TARGET_PHONE_NUMBER or ADVISOR_PHONE_NUMBER is not configured or not E.164.' }, { status: 500 });
  }

  return NextResponse.json({ masked: maskPhone(target) });
}
