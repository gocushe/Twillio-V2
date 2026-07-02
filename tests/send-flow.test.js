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

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('../lib/twilio.js', () => ({ sendMessage: sendMessageMock }));

import { sendTrackedSms } from '../lib/send-flow.js';
import { getRun } from '../lib/sms-runs.js';

beforeEach(() => {
  store.clear();
  sendMessageMock.mockReset();
  process.env.TARGET_PHONE_NUMBER = '+15551230000';
  process.env.TWILIO_FROM_NUMBER = '+15559999999';
  delete process.env.PUBLIC_BASE_URL;
});

describe('sendTrackedSms', () => {
  it('persists twilio_accepted and links the sid on success', async () => {
    sendMessageMock.mockResolvedValue({ success: true, sid: 'SM9', status: 'queued' });
    const r = await sendTrackedSms('hello there');
    expect(r).toMatchObject({ ok: true, http: 202, status: 'twilio_accepted', sid: 'SM9' });
    expect(r.segments.encoding).toBe('GSM-7');

    const run = await getRun(r.runId);
    expect(run.status).toBe('twilio_accepted');
    expect(run.sid).toBe('SM9');
  });

  it('records failed_to_route when the SDK call fails', async () => {
    sendMessageMock.mockResolvedValue({ success: false, error: 'auth error' });
    const r = await sendTrackedSms('hello');
    expect(r).toMatchObject({ ok: false, http: 502, status: 'failed_to_route', error: 'auth error' });
    const run = await getRun(r.runId);
    expect(run.status).toBe('failed_to_route');
  });

  it('rejects an empty body without calling Twilio', async () => {
    const r = await sendTrackedSms('   ');
    expect(r).toMatchObject({ ok: false, http: 400 });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('rejects misconfigured (non-E.164) target', async () => {
    delete process.env.ADVISOR_PHONE_NUMBER;
    process.env.TARGET_PHONE_NUMBER = '5551230000';
    const r = await sendTrackedSms('hi');
    expect(r).toMatchObject({ ok: false, http: 500 });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('falls back to ADVISOR_PHONE_NUMBER when TARGET_PHONE_NUMBER is unset', async () => {
    delete process.env.TARGET_PHONE_NUMBER;
    process.env.ADVISOR_PHONE_NUMBER = '+15558887777';
    sendMessageMock.mockResolvedValue({ success: true, sid: 'SM2', status: 'queued' });

    const r = await sendTrackedSms('hi');

    expect(r.ok).toBe(true);
    expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      to: '+15558887777',
    }));
  });

  it('attaches a statusCallback with runId when PUBLIC_BASE_URL is set', async () => {
    process.env.PUBLIC_BASE_URL = 'https://app.example.com/';
    sendMessageMock.mockResolvedValue({ success: true, sid: 'SM1', status: 'queued' });
    const r = await sendTrackedSms('hi');
    expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      statusCallback: `https://app.example.com/api/sms/status?runId=${r.runId}`,
    }));
  });
});
