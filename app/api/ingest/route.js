import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import {
  sanitizePhone,
  sanitizeDate,
  sanitizeName,
  sanitizePolicyType
} from '@/lib/sanitize';

export async function POST(req) {

  try {
    const body = await req.json();
    const { type, records } = body;

    if (!type || !['birthdays', 'renewals'].includes(type)) {
      return NextResponse.json({ error: 'Invalid data type. Must be "birthdays" or "renewals".' }, { status: 400 });
    }

    if (!Array.isArray(records)) {
      return NextResponse.json({ error: 'Records must be a valid array' }, { status: 400 });
    }

    const redisKey = `clients:${type}`;
    let added = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const rowNum = i + 1;

      const normRec = {};
      for (const [k, v] of Object.entries(rec)) {
        normRec[k.trim().toLowerCase().replace(/[\s_\-]+/g, '')] = v;
      }

      const firstName = sanitizeName(normRec['firstname']);
      const lastName = sanitizeName(normRec['lastname']);
      const rawPhone = normRec['phone'] || normRec['phonenumber'];
      const phone = sanitizePhone(rawPhone);
      const rawEmail = normRec['email'];
      const email = typeof rawEmail === 'string' ? rawEmail.trim() : (rawEmail !== undefined && rawEmail !== null ? String(rawEmail).trim() : '');

      if (!firstName || !lastName) {
        errors.push({ row: rowNum, reason: 'First Name and Last Name are required and cannot be empty.' });
        continue;
      }

      if (!phone) {
        errors.push({ row: rowNum, reason: `Invalid or missing phone number: "${rawPhone || ''}". Must be a valid 10-digit North American number.` });
        continue;
      }

      if (type === 'birthdays') {
        const rawBirthDate = normRec['birthdate'];
        const birthDate = sanitizeDate(rawBirthDate);
        const rawFileLink = normRec['clientfilelink'];
        const fileLink = typeof rawFileLink === 'string' ? rawFileLink.trim() : (rawFileLink !== undefined && rawFileLink !== null ? String(rawFileLink).trim() : '');

        if (!birthDate) {
          errors.push({ row: rowNum, reason: `Invalid or missing Birth Date: "${rawBirthDate || ''}". Accepted formats: YYYY-MM-DD, MM/DD/YYYY.` });
          continue;
        }

        const dedupKey = `${lastName}|${firstName}|${phone}`.trim().toLowerCase();
        const exists = await redis.hexists(redisKey, dedupKey);
        if (exists) updated++; else added++;

        await redis.hset(redisKey, { [dedupKey]: JSON.stringify({ firstName, lastName, phone, birthDate, email, clientFileLink: fileLink }) });

      } else {
        const rawRenewalDate = normRec['renewaldate'];
        const renewalDate = sanitizeDate(rawRenewalDate);
        const rawPolicyType = normRec['policytype'];
        const policyType = sanitizePolicyType(rawPolicyType);

        if (!policyType) {
          errors.push({ row: rowNum, reason: `Invalid Policy Type: "${rawPolicyType || ''}". Must be Life Insurance, Home Insurance, Whole Life Policy, or Corporate.` });
          continue;
        }

        if (!renewalDate) {
          errors.push({ row: rowNum, reason: `Invalid or missing Renewal Date: "${rawRenewalDate || ''}". Accepted formats: YYYY-MM-DD, MM/DD/YYYY.` });
          continue;
        }

        const dedupKey = `${lastName}|${firstName}|${phone}`.trim().toLowerCase();
        const exists = await redis.hexists(redisKey, dedupKey);
        if (exists) updated++; else added++;

        await redis.hset(redisKey, { [dedupKey]: JSON.stringify({ firstName, lastName, policyType, renewalDate, email, phone }) });
      }
    }

    return NextResponse.json({ success: true, added, updated, errors });

  } catch (error) {
    console.error('Ingestion API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
