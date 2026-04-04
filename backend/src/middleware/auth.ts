import type { NextFunction, Request, Response } from 'express';

export type AuthedRequest = Request & {
  userId?: string;
  userEmail?: string;
};

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  req.userId = '00000000-0000-4000-8000-000000000001';
  req.userEmail = 'demo@lumora.app';
  next();
}
