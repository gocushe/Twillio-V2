import { describe, it, expect, beforeEach, vi } from 'vitest';

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map();
  const redisMock = {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v, opts = {}) => {
      if (opts?.nx && store.has(k)) return null;
      store.set(k, typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
      return 'OK';
    },
    del: async (k) => { store.delete(k); return 1; },
  };
  return { store, redisMock };
});
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));

const { sendTrackedSmsMock } = vi.hoisted(() => ({ sendTrackedSmsMock: vi.fn() }));
vi.mock('../lib/send-flow.js', () => ({ sendTrackedSms: sendTrackedSmsMock }));

import { runPipeline } from '../lib/engine.js';

const seed = (id, source) => store.set(`script:${id}`, { id, name: id, source });

beforeEach(() => {
  store.clear();
  sendTrackedSmsMock.mockReset().mockResolvedValue({ ok: true, runId: 'sms1', status: 'twilio_accepted' });
});

describe('runPipeline', () => {
  it('chains steps, handing each output forward as the next context', async () => {
    seed('A', `async function run(input){ return { status:'ok', output:{ n: 2 }, next: 'B' }; }`);
    seed('B', `async function run(input){ return { status:'ok', output:{ doubled: input.context.n * 2 } }; }`);

    const summary = await runPipeline('A', { runId: 'RUN1', context: {} });
    expect(summary.steps).toHaveLength(2);
    expect(summary.steps.map((s) => s.status)).toEqual(['ok', 'ok']);

    const bResult = await redisMock.get('run:RUN1:1:result');
    expect(bResult.output.doubled).toBe(4); // proves context handoff A → B
  });

  it('system-mediates an intent.send_sms (script never sends directly)', async () => {
    seed('S', `async function run(){ return { status:'ok', output:{}, intent:{ type:'send_sms', body:'hi' } }; }`);
    const summary = await runPipeline('S', { runId: 'RUN2' });
    expect(sendTrackedSmsMock).toHaveBeenCalledTimes(1);
    expect(sendTrackedSmsMock).toHaveBeenCalledWith('hi');
    expect(summary.steps[0].intent).toMatchObject({ type: 'send_sms', smsRunId: 'sms1' });
  });

  it('is idempotent — replaying the same runId does not re-send', async () => {
    seed('S', `async function run(){ return { status:'ok', output:{}, intent:{ type:'send_sms', body:'hi' } }; }`);
    await runPipeline('S', { runId: 'RUN3' });
    await runPipeline('S', { runId: 'RUN3' }); // replay
    expect(sendTrackedSmsMock).toHaveBeenCalledTimes(1);
  });

  it('halts the chain on an error step', async () => {
    seed('E', `async function run(){ return { status:'error', output:{}, error:'boom', next:'B' }; }`);
    seed('B', `async function run(){ return { status:'ok', output:{ reached: true } }; }`);
    const summary = await runPipeline('E', { runId: 'RUN4' });
    expect(summary.steps).toHaveLength(1);
    expect(summary.steps[0]).toMatchObject({ status: 'error', error: 'boom' });
    expect(sendTrackedSmsMock).not.toHaveBeenCalled();
  });

  it('reports a missing script id as an error step', async () => {
    const summary = await runPipeline('ghost', { runId: 'RUN5' });
    expect(summary.steps[0]).toMatchObject({ status: 'error', error: 'Script not found' });
  });
});
