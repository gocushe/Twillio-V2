/**
 * E.164 helpers for the SMS panel module.
 *
 * E.164: a leading "+", a non-zero country-code digit, then up to 14 more
 * digits (15 digits total max).
 */

export function isE164(value) {
  return /^\+[1-9]\d{6,14}$/.test(String(value ?? '').trim());
}

/**
 * Display mask for the UI — keep the "+CC" prefix and the last 4 digits only.
 * "+15551234567" -> "+1•••••4567". Never returns the full number.
 */
export function maskPhone(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const last4 = s.slice(-4);
  const prefix = s.startsWith('+') ? s.slice(0, 2) : s.slice(0, 1);
  return `${prefix}•••••${last4}`;
}

/**
 * Log-safe redaction — last 4 digits only, no prefix. Use anywhere a number
 * would otherwise hit logs.
 */
export function redactPhone(value) {
  const s = String(value ?? '').trim();
  if (!s) return '(none)';
  return `••••${s.slice(-4)}`;
}
