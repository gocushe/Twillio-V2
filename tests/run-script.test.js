import { describe, it, expect } from 'vitest';
import { executeScript, normalizeOutput } from '../lib/run-script.js';

// These run the REAL child process — the actual isolation under test.

describe('executeScript (isolated child process)', () => {
  it('runs a pure transform and returns HandoffOutput', async () => {
    const source = `
      async function run(input, helpers) {
        return { status: 'ok', output: { greeting: 'HI ' + helpers.upper(input.context.name) } };
      }
    `;
    const out = await executeScript(source, { runId: 'r', step: 0, context: { name: 'jane' }, meta: {} });
    expect(out.status).toBe('ok');
    expect(out.output.greeting).toBe('HI JANE');
  });

  it('passes through a well-formed send_sms intent', async () => {
    const source = `
      async function run(input) {
        return { status: 'ok', output: {}, intent: { type: 'send_sms', body: 'hello from script' } };
      }
    `;
    const out = await executeScript(source, { runId: 'r', step: 0, context: {}, meta: {} });
    expect(out.intent).toEqual({ type: 'send_sms', body: 'hello from script' });
  });

  it('CANNOT read secrets — scrubbed env + shadowed process', async () => {
    process.env.SECRET_TOKEN = 'supersecret-should-never-leak';
    const source = `
      async function run(input, helpers) {
        let leaked = 'unreachable';
        try { leaked = process.env.SECRET_TOKEN; } catch (e) { leaked = 'threw:' + e.name; }
        return { status: 'ok', output: { leaked } };
      }
    `;
    const out = await executeScript(source, { runId: 'r', step: 0, context: {}, meta: {} });
    expect(JSON.stringify(out)).not.toContain('supersecret');
    expect(out.output.leaked).not.toBe('supersecret-should-never-leak');
  });

  it('kills an infinite loop at the timeout', async () => {
    const source = `async function run() { while (true) {} }`;
    const out = await executeScript(source, { runId: 'r', step: 0, context: {}, meta: {} }, { timeoutMs: 800 });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/timed out/i);
  }, 5000);

  it('errors when the script defines no run()', async () => {
    const out = await executeScript('const x = 1;', { runId: 'r', step: 0, context: {}, meta: {} });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/run\(input, helpers\)/);
  });

  it('keeps stdout clean even if the script logs', async () => {
    const source = `
      async function run() { console.log('noisy'); console.error('also noisy'); return { status: 'ok', output: { ok: 1 } }; }
    `;
    const out = await executeScript(source, { runId: 'r', step: 0, context: {}, meta: {} });
    expect(out.status).toBe('ok');
    expect(out.output.ok).toBe(1);
  });
});

describe('normalizeOutput', () => {
  it('drops a malformed intent', () => {
    expect(normalizeOutput({ status: 'ok', output: {}, intent: { type: 'wipe_db' } }).intent).toBeUndefined();
    expect(normalizeOutput({ status: 'ok', output: {}, intent: { type: 'send_sms' } }).intent).toBeUndefined(); // no body
  });
  it('coerces non-objects to an error', () => {
    expect(normalizeOutput(null).status).toBe('error');
    expect(normalizeOutput('nope').status).toBe('error');
  });
});
