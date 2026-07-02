import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock Redis + Twilio (no real network calls) ────────────────────────────
const { store, redisMock } = vi.hoisted(() => {
  const store = new Map();
  const redisMock = {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v, opts = {}) => {
      if (opts?.nx && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    del: async (k) => { store.delete(k); return store.delete(k) ? 1 : 0; },
    hgetall: async (k) => (store.has(k) ? store.get(k) : null),
  };
  return { store, redisMock };
});

vi.mock('../lib/redis.js', () => ({ redis: redisMock }));
vi.mock('../lib/twilio.js', () => ({
  sendSms: vi.fn(async () => ({ success: true, sid: 'SM_TEST', status: 'queued' })),
}));

import { runDigest, isBirthdayToday, optOutKey } from '../lib/digest.js';
import { sendSms } from '../lib/twilio.js';

const ADVISOR = '+15559990000';

function seedSimDate(date) {
  store.set('sim:mode', 1);
  store.set('sim:date', date);
}

beforeEach(() => {
  store.clear();
  vi.mocked(sendSms).mockClear();
  process.env.ADVISOR_PHONE_NUMBER = ADVISOR;
});

// ── Pure matcher ───────────────────────────────────────────────────────────
describe('isBirthdayToday', () => {
  it('matches an exact month/day', () => {
    expect(isBirthdayToday('1985-06-26', '2026-06-26')).toBe(true);
  });

  it('does not match a different day', () => {
    expect(isBirthdayToday('1985-06-26', '2026-06-25')).toBe(false);
  });

  it('observes a Feb-29 birthday on Feb-28 in a non-leap year', () => {
    expect(isBirthdayToday('1992-02-29', '2026-02-28')).toBe(true); // 2026 not leap
  });

  it('does NOT shift a Feb-29 birthday to Feb-28 in a leap year', () => {
    expect(isBirthdayToday('1992-02-29', '2028-02-28')).toBe(false); // 2028 is leap
    expect(isBirthdayToday('1992-02-29', '2028-02-29')).toBe(true);
  });

  it('returns false for missing inputs', () => {
    expect(isBirthdayToday('', '2026-02-28')).toBe(false);
    expect(isBirthdayToday('1992-02-29', '')).toBe(false);
  });
});

// ── runDigest with mocked Redis + Twilio ────────────────────────────────────
describe('runDigest (mocked Redis + Twilio)', () => {
  it('sends once on a birthday match, then is idempotent on retry', async () => {
    seedSimDate('2026-02-28');
    store.set('clients:birthdays', {
      'doe|jane|+15551234567': JSON.stringify({
        firstName: 'Jane', lastName: 'Doe', phone: '+15551234567', birthDate: '1992-02-29',
      }),
    });

    const first = await runDigest();
    expect(first.smsSent).toBe(true);
    expect(sendSms).toHaveBeenCalledTimes(1);

    const second = await runDigest();
    expect(second.skipped).toBe(true);
    expect(sendSms).toHaveBeenCalledTimes(1); // not sent again
  });

  it('suppresses the send when the recipient has opted out (STOP)', async () => {
    seedSimDate('2026-06-26');
    store.set('clients:birthdays', {
      'doe|jane|+15551234567': JSON.stringify({
        firstName: 'Jane', lastName: 'Doe', phone: '+15551234567', birthDate: '1985-06-26',
      }),
    });
    store.set(optOutKey(ADVISOR), '1');

    const res = await runDigest();
    expect(res.skipped).toBe(true);
    expect(res.reason).toMatch(/opted out/i);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('does not send when there are no matches', async () => {
    seedSimDate('2026-06-26');
    store.set('clients:birthdays', {
      'doe|jane|+15551234567': JSON.stringify({
        firstName: 'Jane', lastName: 'Doe', phone: '+15551234567', birthDate: '1985-01-01',
      }),
    });

    const res = await runDigest();
    expect(res.smsSent).toBe(false);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('previews a matching digest without sending in dry-run mode', async () => {
    seedSimDate('2026-06-26');
    store.set('clients:birthdays', {
      'doe|jane|+15551234567': JSON.stringify({
        firstName: 'Jane', lastName: 'Doe', phone: '+15551234567', birthDate: '1985-06-26',
      }),
    });

    const res = await runDigest(true, { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.smsSent).toBe(false);
    expect(res.body).toMatch(/Jane Doe/);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
