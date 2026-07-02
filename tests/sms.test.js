import { describe, it, expect } from 'vitest';
import { countSmsSegments, isGsm7 } from '../lib/sms.js';

describe('isGsm7', () => {
  it('recognizes plain ASCII as GSM-7', () => {
    expect(isGsm7('B&A 2026-02-28')).toBe(true);
  });

  it('treats extension-table chars (€, {}, []) as GSM-7', () => {
    expect(isGsm7('cost: €5 {x}')).toBe(true);
  });

  it('rejects non-GSM characters (emoji, ☕, curly quotes)', () => {
    expect(isGsm7('😀')).toBe(false);
    expect(isGsm7('coffee ☕')).toBe(false);
    expect(isGsm7('“smart quotes”')).toBe(false);
  });
});

describe('countSmsSegments — GSM-7', () => {
  it('single segment up to 160 chars', () => {
    const r = countSmsSegments('a'.repeat(160));
    expect(r.encoding).toBe('GSM-7');
    expect(r.length).toBe(160);
    expect(r.segments).toBe(1);
  });

  it('splits at 153 chars/segment beyond 160', () => {
    expect(countSmsSegments('a'.repeat(161)).segments).toBe(2);
    expect(countSmsSegments('a'.repeat(306)).segments).toBe(2);
    expect(countSmsSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('counts extension chars (€) as two code units', () => {
    const r = countSmsSegments('€');
    expect(r.encoding).toBe('GSM-7');
    expect(r.length).toBe(2);
    expect(r.segments).toBe(1);
  });

  it('empty string is one segment, length 0', () => {
    expect(countSmsSegments('')).toEqual({ encoding: 'GSM-7', length: 0, segments: 1 });
  });
});

describe('countSmsSegments — UCS-2', () => {
  it('switches to UCS-2 when any char is non-GSM', () => {
    const r = countSmsSegments('coffee ☕');
    expect(r.encoding).toBe('UCS-2');
  });

  it('single segment up to 70 code units', () => {
    const r = countSmsSegments('☕'.repeat(70));
    expect(r.encoding).toBe('UCS-2');
    expect(r.length).toBe(70);
    expect(r.segments).toBe(1);
  });

  it('splits at 67 code units/segment beyond 70', () => {
    expect(countSmsSegments('☕'.repeat(71)).segments).toBe(2);
  });

  it('counts an emoji surrogate pair as two UCS-2 code units', () => {
    const r = countSmsSegments('😀');
    expect(r.encoding).toBe('UCS-2');
    expect(r.length).toBe(2);
    expect(r.segments).toBe(1);
  });
});
