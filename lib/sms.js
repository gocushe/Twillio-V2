/**
 * SMS segment counting (GSM-7 vs UCS-2).
 *
 * If every character is in the GSM 03.38 basic + extension set, the message is
 * encoded GSM-7: 160 chars per single segment, 153 per segment when
 * concatenated. Otherwise it falls back to UCS-2: 70 / 67. Extension-table
 * characters (e.g. ^ { } [ ] ~ | \\ €) cost two GSM-7 code units each.
 */

const GSM7_BASIC = new Set(
  ('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
   '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
    .split('')
);

// Characters that exist in GSM-7 only via the extension table (count as 2).
const GSM7_EXTENSION = new Set('^{}\\[~]|€'.split(''));

export function isGsm7(text) {
  for (const ch of String(text ?? '')) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENSION.has(ch)) return false;
  }
  return true;
}

/**
 * Returns { encoding, length, segments } for the given text.
 * `length` is the billable code-unit count (GSM-7 extension chars count twice).
 */
export function countSmsSegments(text) {
  const str = String(text ?? '');

  if (isGsm7(str)) {
    let units = 0;
    for (const ch of str) units += GSM7_EXTENSION.has(ch) ? 2 : 1;
    const single = 160;
    const concat = 153;
    const segments = units === 0 ? 1 : units <= single ? 1 : Math.ceil(units / concat);
    return { encoding: 'GSM-7', length: units, segments };
  }

  // UCS-2: count UTF-16 code units (surrogate pairs => 2), per Twilio billing.
  const units = str.length;
  const single = 70;
  const concat = 67;
  const segments = units === 0 ? 1 : units <= single ? 1 : Math.ceil(units / concat);
  return { encoding: 'UCS-2', length: units, segments };
}
