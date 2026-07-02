/**
 * Phone Number Sanitization (E.164 compliance for North America)
 */
export function sanitizePhone(phone) {
  if (phone === undefined || phone === null) return null;
  const cleanStr = String(phone).trim();
  let digits = cleanStr.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  return null;
}

/**
 * Deduplication key — case-insensitive, whitespace-collapsed identity for a
 * client built from last name, first name, and sanitized phone. Used so the
 * same person uploaded twice updates rather than duplicates.
 */
export function makeDedupKey(firstName, lastName, phone) {
  const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(lastName)}|${norm(firstName)}|${norm(phone)}`;
}

/**
 * Strict Date Sanitization
 * Accept YYYY-MM-DD and MM/DD/YYYY, normalize to YYYY-MM-DD.
 */
export function sanitizeDate(dateStr) {
  if (dateStr === undefined || dateStr === null) return null;
  const cleanStr = String(dateStr).trim();

  let year, month, day;

  const yyyyMmDdMatch = cleanStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyyMmDdMatch) {
    year = parseInt(yyyyMmDdMatch[1], 10);
    month = parseInt(yyyyMmDdMatch[2], 10);
    day = parseInt(yyyyMmDdMatch[3], 10);
  } else {
    const mmDdYyyyMatch = cleanStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mmDdYyyyMatch) {
      month = parseInt(mmDdYyyyMatch[1], 10);
      day = parseInt(mmDdYyyyMatch[2], 10);
      year = parseInt(mmDdYyyyMatch[3], 10);
    } else {
      return null;
    }
  }

  const parsedDate = new Date(year, month - 1, day);
  if (
    parsedDate.getFullYear() === year &&
    parsedDate.getMonth() === month - 1 &&
    parsedDate.getDate() === day
  ) {
    const mmStr = String(month).padStart(2, '0');
    const ddStr = String(day).padStart(2, '0');
    return `${year}-${mmStr}-${ddStr}`;
  }

  return null;
}

/**
 * Name Validation — trim, reject empty.
 */
export function sanitizeName(name) {
  if (name === undefined || name === null) return null;
  const cleaned = String(name).trim();
  return cleaned.length > 0 ? cleaned : null;
}
