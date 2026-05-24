import type { NextFunction, Request, Response } from 'express';
import { env } from '../lib/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';

export type AuthedRequest = Request & {
  userId?: string;
  userEmail?: string;
};

function bearerToken(req: Request) {
  const header = req.header('authorization') ?? req.header('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function allowLocalDemoAuth() {
  return env.DEMO_MODE || (!env.SUPABASE_URL && !env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = bearerToken(req);

  if (token && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user?.id) {
      res.status(401).json({
        error: 'auth_token_invalid',
        message: 'Sign in again before saving private self character media.',
      });
      return;
    }

    req.userId = data.user.id;
    req.userEmail = data.user.email ?? undefined;
    next();
    return;
  }

  if (allowLocalDemoAuth()) {
    req.userId = '00000000-0000-4000-8000-000000000001';
    req.userEmail = 'demo@example.com';
    next();
    return;
  }

  res.status(401).json({
    error: token ? 'auth_not_configured' : 'auth_required',
    message: token
      ? 'Lumora could not verify your signed-in session on the backend.'
      : 'Sign in before saving private self character media.',
  });
}
