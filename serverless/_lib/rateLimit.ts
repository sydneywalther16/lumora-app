import type { IncomingMessage, ServerResponse } from 'node:http';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitGlobals = typeof globalThis & {
  __lumoraApiRateLimitBuckets?: Map<string, RateLimitBucket>;
};

const globals = globalThis as RateLimitGlobals;
globals.__lumoraApiRateLimitBuckets ??= new Map<string, RateLimitBucket>();

function clientIp(req: IncomingMessage) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (Array.isArray(forwardedFor)) return forwardedFor[0] ?? 'local';
  return forwardedFor?.split(',')[0]?.trim() || req.socket.remoteAddress || 'local';
}

export function checkRateLimit(input: {
  req: IncomingMessage;
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
}) {
  const now = Date.now();
  const key = `${input.keyPrefix}:${clientIp(input.req)}`;
  const current = globals.__lumoraApiRateLimitBuckets?.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + input.windowMs };

  bucket.count += 1;
  globals.__lumoraApiRateLimitBuckets?.set(key, bucket);

  return {
    ok: bucket.count <= input.maxRequests,
    remaining: Math.max(0, input.maxRequests - bucket.count),
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    resetAt: bucket.resetAt,
  };
}

export function sendRateLimitHeaders(res: ServerResponse, input: {
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}) {
  res.setHeader('X-RateLimit-Limit', String(input.limit));
  res.setHeader('X-RateLimit-Remaining', String(input.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(input.resetAt / 1000)));
  if (input.retryAfter) res.setHeader('Retry-After', String(input.retryAfter));
}
