import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAccessKey } from '@/lib/auth';
import {
  sanitizePhone,
  sanitizeDate,
  sanitizeName,
  makeDedupKey
} from '@/lib/sanitize';

const MAX_RECORDS = 5000;

export async function POST(req) {
  const denied = requireAccessKey(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const { type, records } = body;

    if (type !== 'birthdays') {
      return NextResponse.json({ error: 'Invalid data type. Birthday CSV import is the only supported import.' }, { status: 400 });
    }

    if (!Array.isArray(records)) {
      return NextResponse.json({ error: 'Records must be a valid array' }, { status: 400 });
    }

    if (records.length > MAX_RECORDS) {
      return NextResponse.json({ error: `Too many records: ${records.length}. Max ${MAX_RECORDS} per upload.` }, { status: 400 });
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

      const rawBirthDate = normRec['birthdate'];
      const birthDate = sanitizeDate(rawBirthDate);
      const rawFileLink = normRec['clientfilelink'];
      const fileLink = typeof rawFileLink === 'string' ? rawFileLink.trim() : (rawFileLink !== undefined && rawFileLink !== null ? String(rawFileLink).trim() : '');

      if (!birthDate) {
        errors.push({ row: rowNum, reason: `Invalid or missing Birth Date: "${rawBirthDate || ''}". Accepted formats: YYYY-MM-DD, MM/DD/YYYY.` });
        continue;
      }

      const dedupKey = makeDedupKey(firstName, lastName, phone);
      const exists = await redis.hexists(redisKey, dedupKey);
      if (exists) updated++; else added++;

      await redis.hset(redisKey, { [dedupKey]: JSON.stringify({ firstName, lastName, phone, birthDate, email, clientFileLink: fileLink }) });
    }

    return NextResponse.json({ success: true, added, updated, errors });

  } catch (error) {
    console.error('Ingestion API Error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
