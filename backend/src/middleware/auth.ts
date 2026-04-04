import type { NextFunction, Request, Response } from 'express';

export type AuthedRequest = Request & {
  userId?: string;
  userEmail?: string;
};

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  req.userId = 'demo-user';
  req.userEmail = 'demo@lumora.app';
  next();
}
