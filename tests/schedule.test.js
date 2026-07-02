import { describe, it, expect } from 'vitest';
import {
  getBusinessDateParts,
  getDailyRunStatus,
  isWithinQuietHours,
} from '../lib/schedule.js';

describe('Winnipeg schedule', () => {
  it('uses Winnipeg local date and time', () => {
    const parts = getBusinessDateParts(new Date('2026-07-02T14:00:00.000Z'));
    expect(parts).toMatchObject({
      date: '2026-07-02',
      time: '09:00',
      timeZone: 'America/Winnipeg',
    });
  });

  it('opens the daily run window at 9 AM during daylight time', () => {
    const status = getDailyRunStatus(new Date('2026-07-02T14:00:00.000Z'));
    expect(status.shouldRun).toBe(true);
    expect(status.quiet).toBe(false);
  });

  it('keeps the daily run window open for the single Vercel trigger during daylight time', () => {
    const status = getDailyRunStatus(new Date('2026-07-02T15:00:00.000Z'));
    expect(status.shouldRun).toBe(true);
    expect(status.time).toBe('10:00');
  });

  it('opens the daily run window at 9 AM during standard time', () => {
    const status = getDailyRunStatus(new Date('2026-01-02T15:00:00.000Z'));
    expect(status.shouldRun).toBe(true);
    expect(status.time).toBe('09:00');
  });

  it('ignores the inactive UTC check outside the Winnipeg run window', () => {
    const status = getDailyRunStatus(new Date('2026-01-02T14:00:00.000Z'));
    expect(status.shouldRun).toBe(false);
    expect(status.quiet).toBe(false);
    expect(status.time).toBe('08:00');
  });

  it('blocks automatic sends during quiet hours', () => {
    expect(isWithinQuietHours(new Date('2026-07-03T02:00:00.000Z'))).toBe(true);
  });
});
