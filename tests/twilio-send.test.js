import { describe, it, expect, beforeEach, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

const { reserveSmsSendSlotMock } = vi.hoisted(() => ({ reserveSmsSendSlotMock: vi.fn() }));
vi.mock('../lib/sms-rate-limit.js', () => ({
  reserveSmsSendSlot: reserveSmsSendSlotMock,
  isSmsRateLimitError: (error) => error?.code === 'SMS_RATE_LIMITED' || error?.code === 'SMS_RATE_LIMIT_UNAVAILABLE',
}));

import { sendMessage } from '../lib/twilio.js';

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  reserveSmsSendSlotMock.mockReset().mockResolvedValue({ allowed: true, remaining: 9, limit: 10 });
  process.env.TWILIO_ACCOUNT_SID = 'AC_test';
  process.env.TWILIO_AUTH_TOKEN = 'tok_test';
  process.env.TWILIO_FROM_NUMBER = '+15559999999';
});

function twilioResponse(body, status = 201) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe('sendMessage', () => {
  it('returns success with sid + status', async () => {
    fetchMock.mockResolvedValue(twilioResponse({ sid: 'SM1', status: 'queued' }));
    const r = await sendMessage({ to: '+15551234567', body: 'hi', statusCallback: 'https://x/cb' });
    expect(r).toEqual({ success: true, sid: 'SM1', status: 'queued' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC_test:tok_test').toString('base64')}`);
    expect(init.body.get('To')).toBe('+15551234567');
    expect(init.body.get('From')).toBe('+15559999999');
    expect(init.body.get('Body')).toBe('hi');
    expect(init.body.get('StatusCallback')).toBe('https://x/cb');
    expect(reserveSmsSendSlotMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on 429 then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(twilioResponse({ message: 'rate limited', code: 20429 }, 429))
      .mockResolvedValueOnce(twilioResponse({ sid: 'SM2', status: 'accepted' }));
    const r = await sendMessage({ to: '+15551234567', body: 'hi' });
    expect(r.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable error (4xx)', async () => {
    fetchMock.mockResolvedValue(twilioResponse({ message: 'invalid number' }, 400));
    const r = await sendMessage({ to: '+15551234567', body: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/invalid number/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast when credentials are missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const r = await sendMessage({ to: '+15551234567', body: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/TWILIO_ACCOUNT_SID/);
    expect(reserveSmsSendSlotMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks before Twilio when the global SMS limit is reached', async () => {
    reserveSmsSendSlotMock.mockRejectedValue(Object.assign(new Error('SMS send limit reached: 10 texts per hour.'), {
      code: 'SMS_RATE_LIMITED',
      retryAfterSeconds: 120,
      resetAt: Date.now() + 120000,
      limit: 10,
      remaining: 0,
    }));

    const r = await sendMessage({ to: '+15551234567', body: 'hi' });
    expect(r).toMatchObject({
      success: false,
      rateLimited: true,
      code: 'SMS_RATE_LIMITED',
      retryAfterSeconds: 120,
      limit: 10,
      remaining: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
