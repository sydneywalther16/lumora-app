import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { listNotificationsForUser, markNotificationRead, savePushSubscription } from '../services/notificationService';

const subscriptionSchema = z.object({
  subscription: z.unknown(),
});

const markReadSchema = z.object({
  notificationId: z.string().uuid(),
});

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req: AuthedRequest, res) => {
  const notifications = await listNotificationsForUser(req.userId!);
  res.json({ notifications });
});

notificationsRouter.post('/read', async (req: AuthedRequest, res) => {
  const payload = markReadSchema.parse(req.body);
  const notification = await markNotificationRead(req.userId!, payload.notificationId);
  res.json({ notification });
});

notificationsRouter.post('/push/subscribe', async (req: AuthedRequest, res) => {
  const payload = subscriptionSchema.parse(req.body);
  await savePushSubscription({ userId: req.userId!, subscription: payload.subscription });
  res.json({ success: true });
});
