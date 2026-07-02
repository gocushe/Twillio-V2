import { randomUUID } from 'crypto';
import { redis } from './redis.js';
import { getScript } from './scripts.js';
import { executeScript } from './run-script.js';
import { sendTrackedSms } from './send-flow.js';

const MAX_STEPS = 10; // chain-length guard against runaway pipelines
const RESULT_TTL = 60 * 60 * 24; // 24h

/**
 * Run a script (and any chained `next` steps) for a single runId.
 *
 * Guarantees:
 *  - Each (runId, step) executes at most once (Redis NX guard) → idempotent.
 *  - The script is a pure transform; the SYSTEM performs side effects. A
 *    returned intent.send_sms is dispatched here via the Phase-1 send path,
 *    so script scope never touches Twilio credentials or the target number.
 *  - `output.output` of one step becomes `context` of the next; `output.next`
 *    selects the next script id.
 */
export async function runPipeline(startId, { runId = randomUUID(), context = {}, source = 'api' } = {}) {
  const steps = [];
  let currentId = startId;
  let step = 0;
  let ctx = context && typeof context === 'object' ? context : {};

  while (currentId && step < MAX_STEPS) {
    const script = await getScript(currentId);
    if (!script) {
      steps.push({ step, scriptId: currentId, status: 'error', error: 'Script not found' });
      break;
    }

    const guardKey = `run:${runId}:${step}`;
    const resultKey = `run:${runId}:${step}:result`;
    const claimed = await redis.set(guardKey, '1', { nx: true, ex: RESULT_TTL });

    let output;
    if (!claimed) {
      // Replayed step — return the cached result, do NOT re-execute or re-send.
      output = (await redis.get(resultKey)) || { status: 'error', output: {}, error: 'Duplicate step (already executed)' };
    } else {
      const input = {
        runId,
        step,
        context: ctx,
        meta: { timestamp: new Date().toISOString(), source },
      };
      output = await executeScript(script.source, input);
      await redis.set(resultKey, output, { ex: RESULT_TTL });
    }

    const record = { step, scriptId: currentId, name: script.name, status: output.status };
    if (output.error) record.error = output.error;

    // System-mediated side effect — only honored on a fresh (claimed) step so a
    // replay never double-sends.
    if (claimed && output.intent && output.intent.type === 'send_sms') {
      const sent = await sendTrackedSms(output.intent.body);
      record.intent = { type: 'send_sms', smsRunId: sent.runId, status: sent.status, ok: sent.ok, error: sent.error };
    }

    steps.push(record);

    if (output.status !== 'ok') break;       // halt the chain on error
    ctx = output.output || {};               // hand output forward as next context
    currentId = output.next || null;         // follow the chain
    step += 1;
  }

  const summary = { runId, steps, finishedAt: new Date().toISOString() };
  await redis.set(`run:${runId}:summary`, summary, { ex: RESULT_TTL });
  return summary;
}
