import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const CHILD_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'scripts', 'runner', 'child.mjs'
);

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Execute a user script in an isolated child process and return a normalized
 * HandoffOutput. The child runs with a scrubbed env and is SIGKILLed if it
 * exceeds `timeoutMs`. Never throws — failures resolve to { status:'error' }.
 */
export function executeScript(source, input, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child;
    try {
      child = spawn(process.execPath, [CHILD_PATH], {
        env: {}, // scrubbed: no TWILIO_*/UPSTASH_*/APP_ACCESS_KEY/TARGET_PHONE_NUMBER
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return resolve({ status: 'error', output: {}, error: e.message || String(e) });
    }

    let out = '';
    let err = '';

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ status: 'error', output: {}, error: 'Execution timed out' });
    }, timeoutMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ status: 'error', output: {}, error: e.message || String(e) }));
    child.on('close', () => {
      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch {
        return finish({ status: 'error', output: {}, error: err.trim() || 'No parseable output from script' });
      }
      if (!parsed.ok) {
        return finish({ status: 'error', output: {}, error: parsed.error || 'Script error' });
      }
      finish(normalizeOutput(parsed.result));
    });

    child.stdin.on('error', () => { /* ignore EPIPE if the child already exited */ });
    child.stdin.write(JSON.stringify({ source, input }));
    child.stdin.end();
  });
}

/**
 * Coerce arbitrary script return values into a strict HandoffOutput. Only a
 * well-formed intent.send_sms (string body) survives — everything else is
 * dropped so the system never acts on a malformed declarative request.
 */
export function normalizeOutput(result) {
  if (!result || typeof result !== 'object') {
    return { status: 'error', output: {}, error: 'Script did not return a HandoffOutput object' };
  }
  const status = result.status === 'ok' ? 'ok' : 'error';
  const output = (result.output && typeof result.output === 'object') ? result.output : {};
  const normalized = { status, output };

  if (result.error) normalized.error = String(result.error);
  if (result.next) normalized.next = String(result.next);
  if (result.intent && result.intent.type === 'send_sms' && typeof result.intent.body === 'string') {
    normalized.intent = { type: 'send_sms', body: result.intent.body };
  }
  return normalized;
}
