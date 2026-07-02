import { Redis } from '@upstash/redis';
import fs from 'node:fs/promises';
import path from 'node:path';

let instance = null;

const LOCAL_STORE_PATH = path.join(process.cwd(), '.local-data', 'redis.json');

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

class LocalRedis {
  constructor(filePath) {
    this.filePath = filePath;
    this.loaded = false;
    this.state = { kv: {}, hash: {}, zset: {}, expires: {} };
  }

  async load() {
    if (this.loaded) return;
    try {
      this.state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.state.kv ||= {};
      this.state.hash ||= {};
      this.state.zset ||= {};
      this.state.expires ||= {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
    await this.pruneExpired();
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2));
    await fs.rename(tmpPath, this.filePath);
  }

  deleteKey(key) {
    const existed = key in this.state.kv || key in this.state.hash || key in this.state.zset;
    delete this.state.kv[key];
    delete this.state.hash[key];
    delete this.state.zset[key];
    delete this.state.expires[key];
    return existed;
  }

  async pruneExpired() {
    const now = Date.now();
    let changed = false;
    for (const [key, expiresAt] of Object.entries(this.state.expires)) {
      if (expiresAt <= now) {
        this.deleteKey(key);
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  async get(key) {
    await this.load();
    await this.pruneExpired();
    return key in this.state.kv ? clone(this.state.kv[key]) : null;
  }

  async set(key, value, options = {}) {
    await this.load();
    await this.pruneExpired();
    if (options?.nx && key in this.state.kv) return null;
    this.state.kv[key] = clone(value);
    if (options?.ex) this.state.expires[key] = Date.now() + Number(options.ex) * 1000;
    else delete this.state.expires[key];
    await this.save();
    return 'OK';
  }

  async del(...keys) {
    await this.load();
    let count = 0;
    for (const key of keys.flat()) {
      if (this.deleteKey(key)) count++;
    }
    await this.save();
    return count;
  }

  async hset(key, values) {
    await this.load();
    this.state.hash[key] ||= {};
    let count = 0;
    for (const [field, value] of Object.entries(values)) {
      if (!(field in this.state.hash[key])) count++;
      this.state.hash[key][field] = clone(value);
    }
    await this.save();
    return count;
  }

  async hget(key, field) {
    await this.load();
    return this.state.hash[key] && field in this.state.hash[key] ? clone(this.state.hash[key][field]) : null;
  }

  async hgetall(key) {
    await this.load();
    return this.state.hash[key] ? clone(this.state.hash[key]) : null;
  }

  async hexists(key, field) {
    await this.load();
    return this.state.hash[key] && field in this.state.hash[key] ? 1 : 0;
  }

  async hdel(key, field) {
    await this.load();
    if (!this.state.hash[key] || !(field in this.state.hash[key])) return 0;
    delete this.state.hash[key][field];
    await this.save();
    return 1;
  }

  async keys(pattern) {
    await this.load();
    await this.pruneExpired();
    const matcher = patternToRegExp(pattern);
    const keys = new Set([
      ...Object.keys(this.state.kv),
      ...Object.keys(this.state.hash),
      ...Object.keys(this.state.zset),
    ]);
    return [...keys].filter((key) => matcher.test(key));
  }

  async incr(key) {
    const next = Number(await this.get(key) || 0) + 1;
    await this.set(key, next);
    return next;
  }

  async zadd(key, entry) {
    await this.load();
    this.state.zset[key] ||= {};
    this.state.zset[key][entry.member] = Number(entry.score);
    await this.save();
    return 1;
  }

  async zrange(key, start, stop, options = {}) {
    await this.load();
    const entries = Object.entries(this.state.zset[key] || {})
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
    if (options?.rev) entries.reverse();
    const end = stop === -1 ? entries.length : stop + 1;
    return entries.slice(start, end);
  }

  async zrem(key, member) {
    await this.load();
    if (!this.state.zset[key] || !(member in this.state.zset[key])) return 0;
    delete this.state.zset[key][member];
    await this.save();
    return 1;
  }

  async zcard(key) {
    await this.load();
    return Object.keys(this.state.zset[key] || {}).length;
  }

  async zremrangebyscore(key, min, max) {
    await this.load();
    const set = this.state.zset[key] || {};
    let removed = 0;
    for (const [member, score] of Object.entries(set)) {
      if (score >= Number(min) && score <= Number(max)) {
        delete set[member];
        removed++;
      }
    }
    await this.save();
    return removed;
  }

  async expire(key, seconds) {
    await this.load();
    if (!(key in this.state.kv) && !(key in this.state.hash) && !(key in this.state.zset)) return 0;
    this.state.expires[key] = Date.now() + Number(seconds) * 1000;
    await this.save();
    return 1;
  }

  async eval(script, keys, args) {
    await this.load();
    const [key] = keys;
    const [nowRaw, windowRaw, limitRaw, member, ttlRaw] = args;
    const now = Number(nowRaw);
    const windowMs = Number(windowRaw);
    const limit = Number(limitRaw);
    const ttlSeconds = Number(ttlRaw);

    await this.zremrangebyscore(key, 0, now - windowMs);
    const count = await this.zcard(key);

    if (count >= limit) {
      const members = Object.entries(this.state.zset[key] || {}).sort((a, b) => a[1] - b[1]);
      const resetAt = members[0] ? Number(members[0][1]) + windowMs : now + windowMs;
      await this.expire(key, ttlSeconds);
      return [0, 0, resetAt, count];
    }

    await this.zadd(key, { score: now, member });
    await this.expire(key, ttlSeconds);
    return [1, limit - count - 1, now + windowMs, count + 1];
  }
}

function getRedisInstance() {
  if (!instance) {
    const rawUrl = process.env.UPSTASH_REDIS_REST_URL;
    const rawToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if ((!rawUrl || !rawToken) && process.env.NODE_ENV === 'development') {
      console.warn(`Upstash Redis is not configured. Using local development store at ${LOCAL_STORE_PATH}.`);
      instance = new LocalRedis(LOCAL_STORE_PATH);
      return instance;
    }

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
