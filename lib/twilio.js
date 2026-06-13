import twilio from 'twilio';

/**
 * Sends a single consolidated SMS to the ADVISOR_PHONE_NUMBER.
 */
export async function sendSms(body) {
  const rawAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const rawAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const rawFromNumber = process.env.TWILIO_FROM_NUMBER;
  const rawAdvisorNumber = process.env.ADVISOR_PHONE_NUMBER;

  if (!rawAccountSid || !rawAuthToken || !rawFromNumber || !rawAdvisorNumber) {
    const errStr = 'Missing Twilio environment variables: ' +
      [
        !rawAccountSid && 'TWILIO_ACCOUNT_SID',
        !rawAuthToken && 'TWILIO_AUTH_TOKEN',
        !rawFromNumber && 'TWILIO_FROM_NUMBER',
        !rawAdvisorNumber && 'ADVISOR_PHONE_NUMBER'
      ].filter(Boolean).join(', ');
    console.error(errStr);
    return { success: false, error: errStr };
  }

  const accountSid = rawAccountSid.trim().replace(/^"|"$/g, '');
  const authToken = rawAuthToken.trim().replace(/^"|"$/g, '');
  const fromNumber = rawFromNumber.trim().replace(/^"|"$/g, '');
  const advisorNumber = rawAdvisorNumber.trim().replace(/^"|"$/g, '');

  // Enforce 120-character hard cap (GSM-7) to accommodate Twilio trial prefix
  const cleanBody = (body || '').slice(0, 120);

  try {
    const client = twilio(accountSid, authToken);
    const message = await client.messages.create({
      body: cleanBody,
      from: fromNumber,
      to: advisorNumber
    });
    return { success: true, sid: message.sid, status: message.status };
  } catch (error) {
    console.error('Twilio SMS dispatch failed:', error);
    return { success: false, error: error.message || String(error) };
  }
}
