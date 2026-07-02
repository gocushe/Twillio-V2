/**
 * The exact boilerplate every script implements. "Copy Outline" copies this
 * verbatim to the clipboard. Keep it in sync with the documented contract.
 */
export const OUTLINE_TEMPLATE = `// INPUT: predictable, contextual object handed in from the preceding pipeline step.
interface HandoffInput {
  runId: string;
  step: number;
  context: Record<string, unknown>;   // payload produced by the previous step
  meta: { timestamp: string; source: string };
}

// OUTPUT: structured payload consumed by the next step. The SYSTEM acts on \`intent\`,
// the script never performs side effects itself.
interface HandoffOutput {
  status: 'ok' | 'error';
  output: Record<string, unknown>;     // becomes the next step's \`context\`
  intent?: { type: 'send_sms'; body: string };  // declarative request; system executes it
  next?: string;                        // optional id of next script
  error?: string;
}

// The required entrypoint. \`helpers\` is a whitelisted, side-effect-free toolkit
// (e.g. date/format/validation utilities). It exposes NO secrets and NO network.
async function run(input: HandoffInput, helpers: Helpers): Promise<HandoffOutput> {
  // transform input.context -> output
  return { status: 'ok', output: {} };
}
`;
