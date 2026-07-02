import { redis } from './redis.js';
import { sendSms } from './twilio.js';
import { getBusinessDate } from './schedule.js';

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * "Is today the client's birthday?" — matches month/day against the active
 * date. A Feb-29 birthday is observed on Feb-28 in non-leap years so it is
 * never silently skipped.
 */
export function isBirthdayToday(birthDate, activeDate) {
  if (!birthDate || !activeDate) return false;
  const [aYear, aMonth, aDay] = activeDate.split('-').map(Number);
  const [, bMonth, bDay] = birthDate.split('-').map(Number);
  if (!aMonth || !aDay || !bMonth || !bDay) return false;
  if (bMonth === aMonth && bDay === aDay) return true;
  if (aMonth === 2 && aDay === 28 && !isLeapYear(aYear) && bMonth === 2 && bDay === 29) return true;
  return false;
}

export function optOutKey(phone) {
  return `optout:${String(phone ?? '').trim()}`;
}

/**
 * Returns true when a recipient phone has texted STOP and not re-subscribed.
 */
export async function isOptedOut(phone) {
  if (!phone) return false;
  const flag = await redis.get(optOutKey(phone));
  return flag === 1 || flag === '1' || flag === true || flag === 'true';
}

export function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getVancouverDate(date = new Date()) {
  return getBusinessDate(date);
}

export async function getActiveDate() {
  const simMode = await redis.get('sim:mode');
  if (simMode === 1 || simMode === '1') {
    const simDate = await redis.get('sim:date');
    if (simDate) return { activeDate: simDate, isSimulated: true };
  }
  return { activeDate: getBusinessDate(), isSimulated: false };
}

export { getBusinessDate };

export async function runDigest(forceSend = false, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const { activeDate, isSimulated } = await getActiveDate();
  const idempotencyKey = isSimulated ? `digest:sim-sent:${activeDate}` : `digest:sent:${activeDate}`;

  if (!forceSend) {
    const alreadySent = await redis.get(idempotencyKey);
    if (alreadySent) {
      return {
        success: false,
        activeDate,
        isSimulated,
        skipped: true,
        reason: `Digest already sent for active date ${activeDate}`
      };
    }
  }

  const birthdaysHash = await redis.hgetall('clients:birthdays') || {};
  const safeParseHash = (hash, type) => {
    const records = [];
    for (const [key, v] of Object.entries(hash)) {
      if (typeof v === 'string') {
        try { records.push(JSON.parse(v)); }
        catch (e) { console.error(`Malformed JSON in clients:${type} key "${key}":`, e); }
      } else if (v) {
        records.push(v);
      }
    }
    return records;
  };

  const birthdayRecords = safeParseHash(birthdaysHash, 'birthdays');

  const matchedBirthdays = birthdayRecords.filter(client =>
    isBirthdayToday(client.birthDate, activeDate)
  );

  if (matchedBirthdays.length === 0) {
    return {
      success: true,
      activeDate,
      isSimulated,
      skipped: false,
      smsSent: false,
      dryRun,
      reason: 'No birthday reminders found.',
      matches: { birthdays: [] }
    };
  }

  const smsBody = composeSmsBody(matchedBirthdays, activeDate);

  if (dryRun) {
    return {
      success: true,
      activeDate,
      isSimulated,
      skipped: false,
      smsSent: false,
      dryRun: true,
      reason: 'Test mode preview only. No SMS was sent.',
      body: smsBody,
      matches: { birthdays: matchedBirthdays }
    };
  }

  // Compliance: never send to a recipient who has texted STOP.
  if (await isOptedOut(process.env.ADVISOR_PHONE_NUMBER)) {
    return {
      success: true,
      activeDate,
      isSimulated,
      skipped: true,
      smsSent: false,
      dryRun: false,
      reason: 'Recipient opted out (STOP). Digest suppressed.',
      matches: { birthdays: matchedBirthdays }
    };
  }

  // Concurrency guard: claim a short-lived in-flight lock atomically so two
  // overlapping cron/retry invocations cannot both send. The durable
  // `digest:sent` marker (set only on success below) is what blocks resends
  // across retries; this lock only prevents the simultaneous-double-send race.
  if (!forceSend) {
    const lockAcquired = await redis.set(`digest:lock:${activeDate}`, '1', { nx: true, ex: 120 });
    if (!lockAcquired) {
      return {
        success: false,
        activeDate,
        isSimulated,
        skipped: true,
        reason: `Digest send already in progress for ${activeDate}`
      };
    }
  }

  const dispatchResult = await sendSms(smsBody);

  if (dispatchResult.success) {
    await redis.set(idempotencyKey, 'sent', { ex: 172800 });
    await redis.del(`digest:lock:${activeDate}`);
    return {
      success: true,
      activeDate,
      isSimulated,
      skipped: false,
      smsSent: true,
      dryRun: false,
      sid: dispatchResult.sid,
      status: dispatchResult.status,
      body: smsBody,
      matches: { birthdays: matchedBirthdays }
    };
  } else {
    // Release the in-flight lock so a later retry can re-attempt the send.
    await redis.del(`digest:lock:${activeDate}`);
    return {
      success: false,
      activeDate,
      isSimulated,
      skipped: false,
      smsSent: false,
      dryRun: false,
      error: dispatchResult.error,
      rateLimited: dispatchResult.rateLimited,
      retryAfterSeconds: dispatchResult.retryAfterSeconds,
      resetAt: dispatchResult.resetAt,
      limit: dispatchResult.limit,
      remaining: dispatchResult.remaining,
      body: smsBody,
      matches: { birthdays: matchedBirthdays }
    };
  }
}

export function getInitials(firstName, lastName) {
  const f = (firstName || '').trim().charAt(0).toUpperCase();
  const l = (lastName || '').trim().charAt(0).toUpperCase();
  return `${f || '?'}. ${l || '?'}.`;
}

export function composeSmsBody(matchedBirthdays, activeDate) {
  const header = `B&A birthday reminders ${activeDate}:`;

  const birthdayLines = (matchedBirthdays || []).map(client => {
    const name = [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || 'Birthday client';
    const parts = [name, client.birthDate, client.phone, client.email, client.clientFileLink].filter(Boolean);
    return parts.join(' | ');
  });

  let body = header;
  let included = 0;
  for (const line of birthdayLines) {
    const cleanedLine = cleanGsm7(line);
    const candidate = body.endsWith('\n') ? body + cleanedLine : body + '\n' + cleanedLine;
    if (candidate.length > 1000) break;
    body = candidate;
    included++;
  }

  if (included < birthdayLines.length) {
    body += `\n+${birthdayLines.length - included} more`;
  }

  return cleanGsm7(body);
}

export function cleanGsm7(str) {
  if (!str) return '';
  let s = str.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[“”]/g, '"');
  s = s.replace(/[‘’‛]/g, "'");
  s = s.replace(/[—–]/g, '-');
  s = s.replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE');
  return s.split('').filter(char => {
    const code = char.charCodeAt(0);
    if ((code >= 32 && code <= 126) || code === 10 || code === 13) return true;
    const allowedSpecials = '€£¥§¿äöñüÄÖÑÜàèéùìòÇØøÅåÆæßÉ';
    if (allowedSpecials.includes(char)) return true;
    return false;
  }).join('');
}
