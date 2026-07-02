import { randomUUID } from 'crypto';
import { redis } from './redis.js';

export const SMS_RATE_LIMIT = Object.freeze({
  key: 'sms:rate-limit:global',
  limit: 10,
  windowMs: 60 * 60 * 1000,
});

const SMS_QUOTA_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])

redis.call("ZREMRANGEBYSCORE", key, 0, now - window_ms)
local count = redis.call("ZCARD", key)

if count >= limit then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local reset_at = now + window_ms
  if oldest[2] then
    reset_at = tonumber(oldest[2]) + window_ms
  end
  redis.call("EXPIRE", key, ttl_seconds)
  return {0, 0, reset_at, count}
end

redis.call("ZADD", key, now, member)
redis.call("EXPIRE", key, ttl_seconds)
count = count + 1
return {1, limit - count, now + window_ms, count}
`;

export class SmsRateLimitError extends Error {
  constructor(result) {
    super(`SMS send limit reached: ${SMS_RATE_LIMIT.limit} texts per hour.`);
    this.name = 'SmsRateLimitError';
    this.code = 'SMS_RATE_LIMITED';
    this.limit = SMS_RATE_LIMIT.limit;
    this.remaining = result?.remaining ?? 0;
    this.resetAt = result?.resetAt ?? Date.now() + SMS_RATE_LIMIT.windowMs;
    this.retryAfterSeconds = Math.max(1, Math.ceil((this.resetAt - Date.now()) / 1000));
  }
}

export class SmsRateLimitUnavailableError extends Error {
  constructor(cause) {
    super('SMS rate limiter unavailable. Text sending is blocked until Redis is reachable.');
    this.name = 'SmsRateLimitUnavailableError';
    this.code = 'SMS_RATE_LIMIT_UNAVAILABLE';
    this.cause = cause;
    this.limit = SMS_RATE_LIMIT.limit;
    this.remaining = 0;
    this.resetAt = Date.now() + SMS_RATE_LIMIT.windowMs;
    this.retryAfterSeconds = 60;
  }
}

function normalizeRateLimitResult(raw) {
  const [allowed, remaining, resetAt, count] = Array.isArray(raw) ? raw : [];
  return {
    allowed: allowed === 1 || allowed === '1' || allowed === true,
    remaining: Math.max(0, Number(remaining || 0)),
    resetAt: Number(resetAt || Date.now() + SMS_RATE_LIMIT.windowMs),
    count: Number(count || 0),
    limit: SMS_RATE_LIMIT.limit,
  };
}

export async function reserveSmsSendSlot() {
  const now = Date.now();
  const ttlSeconds = Math.ceil(SMS_RATE_LIMIT.windowMs / 1000) + 60;

  let result;
  try {
    result = normalizeRateLimitResult(await redis.eval(
      SMS_QUOTA_SCRIPT,
      [SMS_RATE_LIMIT.key],
      [
        String(now),
        String(SMS_RATE_LIMIT.windowMs),
        String(SMS_RATE_LIMIT.limit),
        `${now}:${randomUUID()}`,
        String(ttlSeconds),
      ]
    ));
  } catch (error) {
    console.error('SMS rate limiter failed closed:', error?.message || error);
    throw new SmsRateLimitUnavailableError(error);
  }

  if (!result.allowed) {
    throw new SmsRateLimitError(result);
  }

  return result;
}

export function isSmsRateLimitError(error) {
  return error?.code === 'SMS_RATE_LIMITED' || error?.code === 'SMS_RATE_LIMIT_UNAVAILABLE';
}
