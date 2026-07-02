import { NextResponse } from 'next/server';
import { requireAccessKey } from '@/lib/auth';
import { getScript } from '@/lib/scripts';
import { runPipeline } from '@/lib/engine';

export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  const { id } = await params;
  const script = await getScript(id);
  if (!script) return NextResponse.json({ error: 'Script not found.' }, { status: 404 });

  let body = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const summary = await runPipeline(id, {
    ...(body?.runId ? { runId: String(body.runId) } : {}),
    context: body?.context && typeof body.context === 'object' ? body.context : {},
    source: 'api',
  });

  return NextResponse.json(summary);
}
