import { describe, it, expect } from 'vitest';
import { isE164, maskPhone, redactPhone } from '../lib/phone.js';

describe('isE164', () => {
  it('accepts valid E.164 numbers', () => {
    expect(isE164('+15551234567')).toBe(true);
    expect(isE164('+447911123456')).toBe(true);
    expect(isE164(' +15551234567 ')).toBe(true);
  });

  it('rejects non-E.164 input', () => {
    expect(isE164('5551234567')).toBe(false);   // no +
    expect(isE164('+0123456789')).toBe(false);   // leading 0 country code
    expect(isE164('+1555')).toBe(false);         // too short
    expect(isE164('+1555123456789012')).toBe(false); // too long
    expect(isE164('')).toBe(false);
    expect(isE164(null)).toBe(false);
  });
});

describe('maskPhone', () => {
  it('keeps +CC prefix and last 4 only', () => {
    expect(maskPhone('+15551234567')).toBe('+1•••••4567');
  });
  it('never returns the full number', () => {
    expect(maskPhone('+15551234567')).not.toContain('5551234');
  });
  it('handles empty', () => {
    expect(maskPhone('')).toBe('');
  });
});

describe('redactPhone', () => {
  it('shows last 4 only for logs', () => {
    expect(redactPhone('+15551234567')).toBe('••••4567');
  });
  it('handles missing', () => {
    expect(redactPhone('')).toBe('(none)');
  });
});
