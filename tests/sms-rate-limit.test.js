import { describe, it, expect, beforeEach, vi } from 'vitest';

const { evalMock } = vi.hoisted(() => ({ evalMock: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ redis: { eval: evalMock } }));

import {
  reserveSmsSendSlot,
  SMS_RATE_LIMIT,
  SmsRateLimitError,
  SmsRateLimitUnavailableError,
} from '../lib/sms-rate-limit.js';

beforeEach(() => {
  evalMock.mockReset();
});

describe('reserveSmsSendSlot', () => {
  it('reserves an outbound SMS slot through Redis', async () => {
    evalMock.mockResolvedValue([1, 9, Date.now() + SMS_RATE_LIMIT.windowMs, 1]);
    const result = await reserveSmsSendSlot();

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      [SMS_RATE_LIMIT.key],
      expect.arrayContaining([String(SMS_RATE_LIMIT.windowMs), String(SMS_RATE_LIMIT.limit)])
    );
  });

  it('throws a rate limit error after 10 sends in the rolling hour', async () => {
    evalMock.mockResolvedValue([0, 0, Date.now() + 60000, 10]);
    await expect(reserveSmsSendSlot()).rejects.toBeInstanceOf(SmsRateLimitError);
  });

  it('fails closed when Redis cannot enforce the limit', async () => {
    evalMock.mockRejectedValue(new Error('redis unavailable'));
    await expect(reserveSmsSendSlot()).rejects.toBeInstanceOf(SmsRateLimitUnavailableError);
  });
});
