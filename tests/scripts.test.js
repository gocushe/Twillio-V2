import { describe, it, expect, beforeEach, vi } from 'vitest';

// Redis mock supporting strings + sorted set + hash ops used by lib/scripts.js
const { reset, redisMock } = vi.hoisted(() => {
  const data = new Map();
  const zsets = new Map();
  const hashes = new Map();
  const redisMock = {
    get: async (k) => (data.has(k) ? data.get(k) : null),
    set: async (k, v) => { data.set(k, JSON.parse(JSON.stringify(v))); return 'OK'; },
    del: async (k) => { data.delete(k); return 1; },
    zadd: async (k, { score, member }) => {
      const m = zsets.get(k) || new Map();
      m.set(member, score);
      zsets.set(k, m);
      return 1;
    },
    zrem: async (k, member) => { zsets.get(k)?.delete(member); return 1; },
    zrange: async (k, start, stop, opts = {}) => {
      const m = zsets.get(k);
      if (!m) return [];
      let arr = [...m.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
      if (opts.rev) arr = arr.reverse();
      const end = stop === -1 ? arr.length - 1 : stop;
      return arr.slice(start, end + 1);
    },
    hget: async (k, f) => hashes.get(k)?.get(f) ?? null,
    hset: async (k, obj) => {
      const h = hashes.get(k) || new Map();
      for (const [f, v] of Object.entries(obj)) h.set(f, v);
      hashes.set(k, h);
      return 1;
    },
    hdel: async (k, f) => { hashes.get(k)?.delete(f); return 1; },
  };
  const reset = () => { data.clear(); zsets.clear(); hashes.clear(); };
  return { reset, redisMock };
});
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));

import { createScript, getScript, updateScript, deleteScript, listScripts } from '../lib/scripts.js';
import { OUTLINE_TEMPLATE } from '../lib/handoff-template.js';

beforeEach(() => reset());

describe('scripts CRUD', () => {
  it('creates and reads back a script', async () => {
    const { script } = await createScript({ name: 'Format Reminder', source: 'x' });
    expect(script.id).toBeTruthy();
    expect(script.name).toBe('Format Reminder');
    const got = await getScript(script.id);
    expect(got.source).toBe('x');
  });

  it('requires a non-empty name', async () => {
    expect(await createScript({ name: '   ' })).toMatchObject({ code: 400 });
  });

  it('rejects a duplicate name (case-insensitive)', async () => {
    await createScript({ name: 'Alpha' });
    const dup = await createScript({ name: '  alpha ' });
    expect(dup).toMatchObject({ code: 409 });
  });

  it('caps source size', async () => {
    const big = 'a'.repeat(100_001);
    expect(await createScript({ name: 'Big', source: big })).toMatchObject({ code: 400 });
  });

  it('renames and frees the old name for reuse', async () => {
    const { script } = await createScript({ name: 'OldName' });
    const upd = await updateScript(script.id, { name: 'NewName' });
    expect(upd.script.name).toBe('NewName');
    // old name now reusable
    expect(await createScript({ name: 'OldName' })).toHaveProperty('script');
  });

  it('blocks renaming onto another script’s name', async () => {
    await createScript({ name: 'One' });
    const { script: two } = await createScript({ name: 'Two' });
    expect(await updateScript(two.id, { name: 'one' })).toMatchObject({ code: 409 });
  });

  it('lists most-recently-updated first', async () => {
    const a = await createScript({ name: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createScript({ name: 'B' });
    await new Promise((r) => setTimeout(r, 5));
    await updateScript(a.script.id, { source: 'touched' }); // bumps A to newest
    const list = await listScripts();
    expect(list.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('deletes a script and its name reservation', async () => {
    const { script } = await createScript({ name: 'Gone' });
    expect(await deleteScript(script.id)).toMatchObject({ ok: true });
    expect(await getScript(script.id)).toBeNull();
    expect(await createScript({ name: 'Gone' })).toHaveProperty('script'); // name freed
  });

  it('404s updating/deleting a missing id', async () => {
    expect(await updateScript('nope', { name: 'x' })).toMatchObject({ code: 404 });
    expect(await deleteScript('nope')).toMatchObject({ code: 404 });
  });
});

describe('Copy Outline template', () => {
  it('is the exact handoff contract', () => {
    expect(OUTLINE_TEMPLATE).toContain('interface HandoffInput');
    expect(OUTLINE_TEMPLATE).toContain('interface HandoffOutput');
    expect(OUTLINE_TEMPLATE).toContain("intent?: { type: 'send_sms'; body: string }");
    expect(OUTLINE_TEMPLATE).toContain('async function run(input: HandoffInput, helpers: Helpers)');
  });
});
