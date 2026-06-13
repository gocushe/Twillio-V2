import { redis } from './redis.js';
import { sendSms } from './twilio.js';

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
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

export function getVancouverDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

export async function getActiveDate() {
  const simMode = await redis.get('sim:mode');
  if (simMode === 1 || simMode === '1') {
    const simDate = await redis.get('sim:date');
    if (simDate) return { activeDate: simDate, isSimulated: true };
  }
  return { activeDate: getVancouverDate(), isSimulated: false };
}

export async function runDigest(forceSend = false) {
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

  const [activeYear, activeMonth, activeDay] = activeDate.split('-').map(Number);

  const birthdaysHash = await redis.hgetall('clients:birthdays') || {};
  const renewalsHash = await redis.hgetall('clients:renewals') || {};

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
  const renewalRecords = safeParseHash(renewalsHash, 'renewals');

  const activeIsFeb28 = (activeMonth === 2 && activeDay === 28);
  const activeYearIsLeap = isLeapYear(activeYear);
  const checkFeb29NonLeap = activeIsFeb28 && !activeYearIsLeap;

  const matchedBirthdays = birthdayRecords.filter(client => {
    if (!client.birthDate) return false;
    const [, bMonth, bDay] = client.birthDate.split('-').map(Number);
    if (bMonth === activeMonth && bDay === activeDay) return true;
    if (checkFeb29NonLeap && bMonth === 2 && bDay === 29) return true;
    return false;
  });

  const targetRenewalDate = addDays(activeDate, 3);
  const [targetRenewalYear, targetRenewalMonth, targetRenewalDay] = targetRenewalDate.split('-').map(Number);
  const targetIsFeb28 = (targetRenewalMonth === 2 && targetRenewalDay === 28);
  const targetYearIsLeap = isLeapYear(targetRenewalYear);
  const checkRenewalFeb29NonLeap = targetIsFeb28 && !targetYearIsLeap;

  const matchedRenewals = renewalRecords.filter(policy => {
    if (!policy.renewalDate) return false;
    const [, rMonth, rDay] = policy.renewalDate.split('-').map(Number);
    if (rMonth === targetRenewalMonth && rDay === targetRenewalDay) return true;
    if (checkRenewalFeb29NonLeap && rMonth === 2 && rDay === 29) return true;
    return false;
  });

  if (matchedBirthdays.length === 0 && matchedRenewals.length === 0) {
    return {
      success: true,
      activeDate,
      isSimulated,
      skipped: false,
      smsSent: false,
      reason: 'No matches found for birthdays or renewals.',
      matches: { birthdays: [], renewals: [] }
    };
  }

  const smsBody = composeSmsBody(matchedBirthdays, matchedRenewals, activeDate);
  const dispatchResult = await sendSms(smsBody);

  if (dispatchResult.success) {
    await redis.set(idempotencyKey, 'sent', { ex: 172800 });
    return {
      success: true,
      activeDate,
      isSimulated,
      skipped: false,
      smsSent: true,
      sid: dispatchResult.sid,
      status: dispatchResult.status,
      body: smsBody,
      matches: { birthdays: matchedBirthdays, renewals: matchedRenewals }
    };
  } else {
    return {
      success: false,
      activeDate,
      isSimulated,
      skipped: false,
      smsSent: false,
      error: dispatchResult.error,
      body: smsBody,
      matches: { birthdays: matchedBirthdays, renewals: matchedRenewals }
    };
  }
}

export function getInitials(firstName, lastName) {
  const f = (firstName || '').trim().charAt(0).toUpperCase();
  const l = (lastName || '').trim().charAt(0).toUpperCase();
  return `${f || '?'}. ${l || '?'}.`;
}

export function abbreviatePolicyType(policyType) {
  if (!policyType) return '';
  let pt = policyType;
  pt = pt.replace(/Life Insurance/gi, 'Life Ins');
  pt = pt.replace(/Home Insurance/gi, 'Home Ins');
  pt = pt.replace(/Whole Life Policy/gi, 'Whole Life');
  pt = pt.replace(/Corporate/gi, 'Corp');
  return pt;
}

export function composeSmsBody(matchedBirthdays, matchedRenewals, activeDate) {
  const header = `B&A ${activeDate}:\n`;

  const birthdayLines = (matchedBirthdays || []).map(client => {
    const initials = getInitials(client.firstName, client.lastName);
    return `B: ${initials} ${client.birthDate} ${client.phone}`;
  });

  const targetRenewalDate = addDays(activeDate, 3);
  const renewalLines = (matchedRenewals || []).map(policy => {
    const initials = getInitials(policy.firstName, policy.lastName);
    const policyTypeAbbr = abbreviatePolicyType(policy.policyType);
    return `R: ${initials} ${policyTypeAbbr} ${targetRenewalDate} ${policy.phone}`;
  });

  const interleavedLines = [];
  const maxLength = Math.max(birthdayLines.length, renewalLines.length);
  for (let i = 0; i < maxLength; i++) {
    if (i < birthdayLines.length) interleavedLines.push(birthdayLines[i]);
    if (i < renewalLines.length) interleavedLines.push(renewalLines[i]);
  }

  let body = header;
  for (const line of interleavedLines) {
    const cleanedLine = cleanGsm7(line);
    const candidate = body.endsWith('\n') ? body + cleanedLine : body + '\n' + cleanedLine;
    if (candidate.length > 120) break;
    body = candidate;
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
