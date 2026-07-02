import { NextResponse } from 'next/server';
import { requireAccessKey } from '@/lib/auth';
import { getRun } from '@/lib/sms-runs';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }

  return NextResponse.json(run);
}
