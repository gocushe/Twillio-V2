import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { validateTwilioRequest } from '../lib/auth.js';

describe('validateTwilioRequest', () => {
  it('validates Twilio form signatures without the Twilio SDK', () => {
    const token = 'test_token';
    const url = 'https://app.example.com/api/sms/status?runId=run1';
    const params = { MessageStatus: 'delivered', MessageSid: 'SM123' };
    const signed = Object.keys(params)
      .sort()
      .reduce((acc, key) => `${acc}${key}${params[key]}`, url);
    const signature = createHmac('sha1', token).update(signed).digest('base64');

    expect(validateTwilioRequest(token, signature, url, params)).toBe(true);
    expect(validateTwilioRequest(token, 'bad-signature', url, params)).toBe(false);
  });
});
