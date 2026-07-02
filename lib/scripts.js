import { randomUUID } from 'crypto';
import { redis } from './redis.js';

/**
 * Script storage (CRUD).
 *
 *   script:<id>    = { id, name, source, updatedAt, inputSchema? }
 *   scripts:index  = sorted set of ids, scored by updatedAt (ms)
 *   scripts:names  = hash { normalizedName -> id } for uniqueness
 *
 * Mutating helpers return { script } / { ok } on success or { error, code } on
 * a validation/conflict failure, so API routes map straight to HTTP.
 */

const SCRIPT_KEY = (id) => `script:${id}`;
const INDEX = 'scripts:index';
const NAMES = 'scripts:names';

const MAX_SOURCE = 100_000; // 100 KB
const MAX_NAME = 120;

export function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase();
}

export async function listScripts() {
  const ids = (await redis.zrange(INDEX, 0, -1, { rev: true })) || [];
  if (!ids.length) return [];
  const records = await Promise.all(ids.map((id) => redis.get(SCRIPT_KEY(id))));
  return records.filter(Boolean);
}

export async function getScript(id) {
  if (!id) return null;
  return await redis.get(SCRIPT_KEY(id));
}

export async function createScript({ name, source = '', inputSchema } = {}) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return { error: 'Name is required.', code: 400 };
  if (cleanName.length > MAX_NAME) return { error: `Name too long (max ${MAX_NAME}).`, code: 400 };
  if (String(source).length > MAX_SOURCE) return { error: `Source too large (max ${MAX_SOURCE} bytes).`, code: 400 };

  const key = normalizeName(cleanName);
  if (await redis.hget(NAMES, key)) {
    return { error: 'A script with that name already exists.', code: 409 };
  }

  const id = randomUUID();
  const record = {
    id,
    name: cleanName,
    source: String(source),
    updatedAt: new Date().toISOString(),
    ...(inputSchema ? { inputSchema: String(inputSchema) } : {}),
  };

  await redis.set(SCRIPT_KEY(id), record);
  await redis.zadd(INDEX, { score: Date.now(), member: id });
  await redis.hset(NAMES, { [key]: id });
  return { script: record };
}

export async function updateScript(id, { name, source, inputSchema } = {}) {
  const record = await getScript(id);
  if (!record) return { error: 'Script not found.', code: 404 };

  let nextName = record.name;
  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) return { error: 'Name is required.', code: 400 };
    if (cleanName.length > MAX_NAME) return { error: `Name too long (max ${MAX_NAME}).`, code: 400 };
    const owner = await redis.hget(NAMES, normalizeName(cleanName));
    if (owner && owner !== id) return { error: 'A script with that name already exists.', code: 409 };
    nextName = cleanName;
  }

  if (source !== undefined && String(source).length > MAX_SOURCE) {
    return { error: `Source too large (max ${MAX_SOURCE} bytes).`, code: 400 };
  }

  if (normalizeName(nextName) !== normalizeName(record.name)) {
    await redis.hdel(NAMES, normalizeName(record.name));
    await redis.hset(NAMES, { [normalizeName(nextName)]: id });
  }

  const updated = {
    ...record,
    name: nextName,
    source: source !== undefined ? String(source) : record.source,
    updatedAt: new Date().toISOString(),
    ...(inputSchema !== undefined ? { inputSchema: String(inputSchema) } : {}),
  };

  await redis.set(SCRIPT_KEY(id), updated);
  await redis.zadd(INDEX, { score: Date.now(), member: id });
  return { script: updated };
}

export async function deleteScript(id) {
  const record = await getScript(id);
  if (!record) return { error: 'Script not found.', code: 404 };
  await redis.del(SCRIPT_KEY(id));
  await redis.zrem(INDEX, id);
  await redis.hdel(NAMES, normalizeName(record.name));
  return { ok: true };
}
