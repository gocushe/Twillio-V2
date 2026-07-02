import { redis } from './redis.js';

/**
 * Status lifecycle store for outbound SMS sends, keyed by runId.
 *
 * Record shape:
 *   { runId, body, createdAt, status, sid, history: [{ status, at, detail? }] }
 *
 * Status values: draft | request_sent | failed_to_route | twilio_accepted |
 *                text_delivered | failed_delivery
 */

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Terminal states never transition further.
const TERMINAL = new Set(['failed_to_route', 'text_delivered', 'failed_delivery']);

export function runKey(runId) { return `sms:${runId}`; }
export function sidKey(sid) { return `sid:${sid}`; }

export function isTerminal(status) { return TERMINAL.has(status); }

/**
 * Map a raw Twilio MessageStatus to our app status, or null when the callback
 * carries no meaningful transition (e.g. "sent"/"queued" → stay twilio_accepted).
 */
export function mapTwilioStatus(messageStatus) {
  switch (String(messageStatus ?? '').toLowerCase()) {
    case 'delivered': return 'text_delivered';
    case 'failed':
    case 'undelivered': return 'failed_delivery';
    default: return null; // queued/sending/sent/accepted → no-op
  }
}

export async function createRun(runId, body) {
  const now = new Date().toISOString();
  const record = {
    runId,
    body,
    createdAt: now,
    status: 'request_sent',
    sid: null,
    history: [{ status: 'request_sent', at: now }],
  };
  await redis.set(runKey(runId), record, { ex: TTL_SECONDS });
  return record;
}

export async function getRun(runId) {
  if (!runId) return null;
  return await redis.get(runKey(runId));
}

/**
 * Transition a run to `status`, appending to history only on an actual change
 * (idempotent — re-applying the same status is a no-op). Refuses to move a run
 * out of a terminal state. `extra` patches top-level fields (e.g. { sid }).
 */
export async function updateStatus(runId, status, detail, extra = {}) {
  const record = await getRun(runId);
  if (!record) return null;

  if (isTerminal(record.status)) {
    return record; // already final; ignore late/duplicate callbacks
  }

  const changed = record.status !== status;
  if (changed) {
    record.status = status;
    record.history.push({ status, at: new Date().toISOString(), ...(detail ? { detail } : {}) });
  }
  Object.assign(record, extra);

  if (changed || Object.keys(extra).length > 0) {
    await redis.set(runKey(runId), record, { ex: TTL_SECONDS });
  }
  return record;
}

export async function linkSid(sid, runId) {
  if (!sid) return;
  await redis.set(sidKey(sid), runId, { ex: TTL_SECONDS });
}

export async function runIdForSid(sid) {
  if (!sid) return null;
  return await redis.get(sidKey(sid));
}
