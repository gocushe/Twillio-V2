import { Redis } from '@upstash/redis';

let instance = null;

function getRedisInstance() {
  if (!instance) {
    const rawUrl = process.env.UPSTASH_REDIS_REST_URL;
    const rawToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!rawUrl) {
      throw new Error('Missing environment variable: UPSTASH_REDIS_REST_URL');
    }
    if (!rawToken) {
      throw new Error('Missing environment variable: UPSTASH_REDIS_REST_TOKEN');
    }

    const cleanUrl = rawUrl.trim().replace(/^"|"$/g, '');
    const cleanToken = rawToken.trim().replace(/^"|"$/g, '');

    instance = new Redis({
      url: cleanUrl,
      token: cleanToken,
    });
  }
  return instance;
}

export const redis = new Proxy({}, {
  get(target, prop) {
    const redisInstance = getRedisInstance();
    const value = redisInstance[prop];
    if (typeof value === 'function') {
      return value.bind(redisInstance);
    }
    return value;
  }
});
