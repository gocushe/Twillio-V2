import { describe, it, expect, beforeEach, vi } from 'vitest';

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map();
  const redisMock = {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); return 'OK'; },
    del: async (k) => { store.delete(k); return 1; },
  };
  return { store, redisMock };
});
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));

import {
  createRun, getRun, updateStatus, linkSid, runIdForSid,
  mapTwilioStatus, isTerminal,
} from '../lib/sms-runs.js';

beforeEach(() => store.clear());

describe('mapTwilioStatus', () => {
  it('maps carrier-final statuses', () => {
    expect(mapTwilioStatus('delivered')).toBe('text_delivered');
    expect(mapTwilioStatus('failed')).toBe('failed_delivery');
    expect(mapTwilioStatus('undelivered')).toBe('failed_delivery');
  });
  it('returns null for intermediate statuses (no transition)', () => {
    expect(mapTwilioStatus('queued')).toBeNull();
    expect(mapTwilioStatus('sent')).toBeNull();
    expect(mapTwilioStatus('')).toBeNull();
  });
});

describe('run lifecycle', () => {
  it('creates a run at request_sent with history', async () => {
    const r = await createRun('run1', 'hello');
    expect(r.status).toBe('request_sent');
    expect(r.history).toHaveLength(1);
    expect((await getRun('run1')).body).toBe('hello');
  });

  it('appends history only on actual status change (idempotent)', async () => {
    await createRun('run2', 'hi');
    await updateStatus('run2', 'twilio_accepted', 'queued', { sid: 'SM1' });
    const afterFirst = await getRun('run2');
    expect(afterFirst.status).toBe('twilio_accepted');
    expect(afterFirst.sid).toBe('SM1');
    expect(afterFirst.history).toHaveLength(2);

    // Re-applying the same status is a no-op for history.
    await updateStatus('run2', 'twilio_accepted', 'sent');
    expect((await getRun('run2')).history).toHaveLength(2);

    // Real transition appends.
    await updateStatus('run2', 'text_delivered', 'twilio:delivered');
    expect((await getRun('run2')).history).toHaveLength(3);
  });

  it('refuses to move out of a terminal state', async () => {
    await createRun('run3', 'x');
    await updateStatus('run3', 'text_delivered');
    await updateStatus('run3', 'failed_delivery'); // late/duplicate callback
    const r = await getRun('run3');
    expect(r.status).toBe('text_delivered');
    expect(r.history).toHaveLength(2); // request_sent + text_delivered
  });

  it('maps sid → runId', async () => {
    await linkSid('SM_ABC', 'run4');
    expect(await runIdForSid('SM_ABC')).toBe('run4');
  });

  it('isTerminal flags only final states', () => {
    expect(isTerminal('text_delivered')).toBe(true);
    expect(isTerminal('failed_delivery')).toBe(true);
    expect(isTerminal('failed_to_route')).toBe(true);
    expect(isTerminal('twilio_accepted')).toBe(false);
    expect(isTerminal('request_sent')).toBe(false);
  });
});
