import { describe, it, expect } from 'vitest';
import { sanitizePhone, sanitizeDate, makeDedupKey } from '../lib/sanitize.js';

describe('sanitizePhone', () => {
  it('accepts a bare 10-digit number', () => {
    expect(sanitizePhone('5551234567')).toBe('+15551234567');
  });

  it('strips a leading 1 from an 11-digit number', () => {
    expect(sanitizePhone('15551234567')).toBe('+15551234567');
  });

  it('ignores formatting (spaces, parens, dashes, +1)', () => {
    expect(sanitizePhone('+1 (555) 123-4567')).toBe('+15551234567');
    expect(sanitizePhone(' 555.123.4567 ')).toBe('+15551234567');
  });

  it('rejects too-short numbers', () => {
    expect(sanitizePhone('555123456')).toBeNull();
  });

  it('rejects too-long / invalid numbers', () => {
    expect(sanitizePhone('255512345670')).toBeNull();
    expect(sanitizePhone('abcdefghij')).toBeNull();
  });

  it('rejects empty / null / undefined', () => {
    expect(sanitizePhone('')).toBeNull();
    expect(sanitizePhone(null)).toBeNull();
    expect(sanitizePhone(undefined)).toBeNull();
  });
});

describe('makeDedupKey (dedup normalization)', () => {
  it('builds last|first|phone lowercased', () => {
    expect(makeDedupKey('Jane', 'Doe', '+15551234567')).toBe('doe|jane|+15551234567');
  });

  it('is case-insensitive and whitespace-insensitive', () => {
    expect(makeDedupKey('  jane ', 'DOE', '+15551234567'))
      .toBe(makeDedupKey('Jane', 'Doe', '+15551234567'));
  });

  it('collapses internal whitespace in names', () => {
    expect(makeDedupKey('Mary  Jane', 'Van  Dyke', '+15551234567'))
      .toBe('van dyke|mary jane|+15551234567');
  });

  it('handles null/undefined fields without throwing', () => {
    expect(makeDedupKey(null, undefined, '')).toBe('||');
  });
});

describe('sanitizeDate (CSV row date validator)', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(sanitizeDate('2026-02-28')).toBe('2026-02-28');
    expect(sanitizeDate('2026-2-8')).toBe('2026-02-08');
  });

  it('accepts MM/DD/YYYY and normalizes to YYYY-MM-DD', () => {
    expect(sanitizeDate('02/28/2026')).toBe('2026-02-28');
    expect(sanitizeDate('2/8/2026')).toBe('2026-02-08');
  });

  it('rejects every other format', () => {
    expect(sanitizeDate('28-02-2026')).toBeNull();   // DD-MM-YYYY
    expect(sanitizeDate('2026/02/28')).toBeNull();    // slashes, YYYY first
    expect(sanitizeDate('Feb 28 2026')).toBeNull();   // words
    expect(sanitizeDate('28/02/2026')).toBeNull();    // DD/MM/YYYY (invalid month 28)
    expect(sanitizeDate('2026.02.28')).toBeNull();    // dots
  });

  it('rejects impossible calendar dates', () => {
    expect(sanitizeDate('2026-13-01')).toBeNull();    // month 13
    expect(sanitizeDate('2026-02-30')).toBeNull();    // Feb 30
    expect(sanitizeDate('2026-00-10')).toBeNull();    // month 0
  });

  it('rejects empty / null', () => {
    expect(sanitizeDate('')).toBeNull();
    expect(sanitizeDate(null)).toBeNull();
  });
});
