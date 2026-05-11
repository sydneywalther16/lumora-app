import type { CorsOptions, CorsOptionsDelegate } from 'cors';
import type { Request } from 'express';
import { env } from './env';

const CORS_CREDENTIALS_ENABLED = true;
const LOCALHOST_PORTS = new Set(['3000', '4173', '4174', '4175', '4176', '5173']);
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const VERCEL_APP_HOST_PATTERN = /^[a-z0-9-]+\.vercel\.app$/i;
const VERCEL_WILDCARD_TOKENS = new Set(['https://*.vercel.app', '*.vercel.app']);

type ParsedOrigin = {
  origin: string;
  protocol: string;
  hostname: string;
  port: string;
};

type CorsDecision = {
  allowed: boolean;
  reason: string;
  normalizedOrigin: string | null;
  responseOrigin?: string;
};

function parseOrigin(value: string): ParsedOrigin | null {
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue === 'null') return null;

  try {
    const url = new URL(trimmedValue);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    return {
      origin: url.origin,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
    };
  } catch {
    return null;
  }
}

function parseConfiguredOrigins(values: Array<string | undefined>) {
  const origins = new Set<string>();
  const wildcardIgnored: string[] = [];
  const invalidOrigins: string[] = [];

  for (const value of values) {
    for (const rawOrigin of (value ?? '').split(',')) {
      const trimmedOrigin = rawOrigin.trim();
      if (!trimmedOrigin) continue;

      if (trimmedOrigin === '*') {
        wildcardIgnored.push(trimmedOrigin);
        continue;
      }

      if (VERCEL_WILDCARD_TOKENS.has(trimmedOrigin.toLowerCase())) {
        continue;
      }

      const parsed = parseOrigin(trimmedOrigin);
      if (!parsed) {
        invalidOrigins.push(trimmedOrigin);
        continue;
      }

      origins.add(parsed.origin);
    }
  }

  if (wildcardIgnored.length) {
    console.warn('CORS WILDCARD ORIGIN IGNORED:', {
      wildcardIgnored,
      credentials: CORS_CREDENTIALS_ENABLED,
      reason: 'Wildcard origins are not allowed when credentialed CORS is enabled.',
      production: process.env.NODE_ENV === 'production',
    });
  }

  if (invalidOrigins.length) {
    console.warn('CORS CONFIGURED ORIGINS IGNORED:', {
      invalidOrigins,
      reason: 'Expected absolute http(s) origins or comma-separated WEB_ORIGIN values.',
    });
  }

  return origins;
}

const configuredAllowedOrigins = parseConfiguredOrigins([
  env.WEB_ORIGIN,
  env.APP_URL,
]);

function isAllowedLocalhost(parsed: ParsedOrigin) {
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    LOCALHOST_HOSTS.has(parsed.hostname) &&
    LOCALHOST_PORTS.has(parsed.port)
  );
}

function isAllowedVercelApp(parsed: ParsedOrigin) {
  return parsed.protocol === 'https:' && VERCEL_APP_HOST_PATTERN.test(parsed.hostname);
}

export function decideCorsOrigin(origin: string | undefined): CorsDecision {
  if (!origin) {
    return {
      allowed: true,
      reason: 'no-origin-header',
      normalizedOrigin: null,
    };
  }

  const parsed = parseOrigin(origin);
  if (!parsed) {
    return {
      allowed: false,
      reason: 'invalid-origin-header',
      normalizedOrigin: null,
    };
  }

  if (configuredAllowedOrigins.has(parsed.origin)) {
    return {
      allowed: true,
      reason: 'configured-origin',
      normalizedOrigin: parsed.origin,
      responseOrigin: parsed.origin,
    };
  }

  if (isAllowedLocalhost(parsed)) {
    return {
      allowed: true,
      reason: 'localhost-dev-origin',
      normalizedOrigin: parsed.origin,
      responseOrigin: parsed.origin,
    };
  }

  if (isAllowedVercelApp(parsed)) {
    return {
      allowed: true,
      reason: 'vercel-app-origin',
      normalizedOrigin: parsed.origin,
      responseOrigin: parsed.origin,
    };
  }

  return {
    allowed: false,
    reason: 'origin-not-allowed',
    normalizedOrigin: parsed.origin,
  };
}

export const corsOptionsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
  const requestOrigin = req.header('Origin') ?? undefined;
  const decision = decideCorsOrigin(requestOrigin);
  const options: CorsOptions = {
    origin: decision.allowed && decision.responseOrigin ? decision.responseOrigin : false,
    credentials: CORS_CREDENTIALS_ENABLED,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    optionsSuccessStatus: 204,
    maxAge: 86_400,
  };

  console.info('CORS CHECK:', {
    origin: requestOrigin ?? null,
    normalizedOrigin: decision.normalizedOrigin,
    method: req.method,
    path: req.originalUrl,
    allowed: decision.allowed,
    reason: decision.reason,
    preflight: req.method === 'OPTIONS',
    credentials: CORS_CREDENTIALS_ENABLED,
  });

  callback(null, options);
};

export function logCorsConfiguration() {
  console.info('CORS CONFIGURATION:', {
    credentials: CORS_CREDENTIALS_ENABLED,
    configuredOrigins: Array.from(configuredAllowedOrigins),
    localhostPorts: Array.from(LOCALHOST_PORTS),
    vercelAppOriginsAllowed: true,
    webOriginConfigured: Boolean(env.WEB_ORIGIN?.trim()),
    nodeEnv: process.env.NODE_ENV ?? 'development',
  });
}
