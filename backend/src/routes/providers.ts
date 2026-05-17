import { Router } from 'express';
import { env } from '../lib/env';
import { handleReplicateWebhookPayload } from '../services/renderJobPoller';

export const providersRouter = Router();

providersRouter.post('/replicate/webhook', async (req, res) => {
  if (env.REPLICATE_WEBHOOK_SECRET) {
    const bearer = typeof req.headers.authorization === 'string'
      ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim()
      : '';
    const headerSecret = typeof req.headers['x-lumora-webhook-secret'] === 'string'
      ? req.headers['x-lumora-webhook-secret']
      : '';

    if (bearer !== env.REPLICATE_WEBHOOK_SECRET && headerSecret !== env.REPLICATE_WEBHOOK_SECRET) {
      res.status(401).json({ ok: false, error: 'Webhook signature could not be verified.' });
      return;
    }
  }

  const result = await handleReplicateWebhookPayload(req.body);
  res.json(result);
});
