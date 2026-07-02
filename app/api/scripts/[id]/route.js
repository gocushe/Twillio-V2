import { NextResponse } from 'next/server';
import { requireAccessKey } from '@/lib/auth';
import { getScript, updateScript, deleteScript } from '@/lib/scripts';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  const { id } = await params;
  const script = await getScript(id);
  if (!script) return NextResponse.json({ error: 'Script not found.' }, { status: 404 });
  return NextResponse.json({ script });
}

export async function PUT(req, { params }) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  const { id } = await params;
  let payload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await updateScript(id, payload || {});
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.code });
  return NextResponse.json({ script: result.script });
}

export async function DELETE(req, { params }) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  const { id } = await params;
  const result = await deleteScript(id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.code });
  return NextResponse.json({ ok: true });
}
