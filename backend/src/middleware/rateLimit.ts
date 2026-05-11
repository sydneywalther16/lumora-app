import type { RequestHandler } from 'express';

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

function clientKey(req: Parameters<RequestHandler>[0], keyPrefix: string) {
  return `${keyPrefix}:${req.ip || req.headers['x-forwarded-for'] || 'local'}`;
}

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    const key = clientKey(req, options.keyPrefix);
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + options.windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, options.maxRequests - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        status: 'failed',
        error: 'Too many generation requests. Please wait before trying again.',
        retryAfter,
      });
      return;
    }

    next();
  };
}
