import { NextResponse } from 'next/server';
import { requireAccessKey } from '@/lib/auth';
import { listScripts, createScript } from '@/lib/scripts';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  const scripts = await listScripts();
  return NextResponse.json({ scripts });
}

export async function POST(req) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  let payload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await createScript(payload || {});
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.code });
  }
  return NextResponse.json({ script: result.script }, { status: 201 });
}
