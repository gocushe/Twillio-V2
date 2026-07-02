/**
 * Isolated script runner (child process).
 *
 * Spawned by lib/run-script.js with a SCRUBBED env ({}), so no TWILIO_*,
 * UPSTASH_*, APP_ACCESS_KEY, or TARGET_PHONE_NUMBER is reachable here. Reads
 * { source, input } as JSON on stdin, runs the user's `run(input, helpers)`,
 * and writes a single { ok, result|error } JSON object to stdout.
 *
 * Hard isolation guarantees:
 *  - process-level env scrub (the real secret barrier)
 *  - dangerous globals shadowed inside the user scope (process/require/fetch/…)
 *  - user console.* redirected to stderr so stdout carries ONLY the result JSON
 *  - parent enforces a hard timeout and SIGKILLs an overrun
 */

// Pure, side-effect-free toolkit exposed to scripts. No network, no fs, no env.
const helpers = {
  isE164: (v) => /^\+[1-9]\d{6,14}$/.test(String(v ?? '').trim()),
  trim: (s) => String(s ?? '').trim(),
  upper: (s) => String(s ?? '').toUpperCase(),
  lower: (s) => String(s ?? '').toLowerCase(),
  pad2: (n) => String(n).padStart(2, '0'),
  parseJSON: (s) => { try { return JSON.parse(s); } catch { return null; } },
  formatDate: (d) => {
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  },
};

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

(async () => {
  // Keep stdout pristine: route any user logging to stderr.
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    console[m] = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');
  }

  try {
    const { source, input } = JSON.parse(await readStdin());

    const factory = new Function(
      'input', 'helpers',
      '"use strict";\n' +
      // Shadow escape hatches to undefined within the user scope.
      'const process=undefined, require=undefined, module=undefined, exports=undefined,' +
      ' fetch=undefined, global=undefined, globalThis=undefined, Buffer=undefined,' +
      ' __dirname=undefined, __filename=undefined;\n' +
      String(source) + '\n' +
      'if (typeof run !== "function") throw new Error("script must define a run(input, helpers) function");\n' +
      'return run(input, helpers);'
    );

    const result = await factory(input, helpers);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: (e && e.message) || String(e) }));
  }
})();
