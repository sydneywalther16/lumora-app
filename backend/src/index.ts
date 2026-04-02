import express from 'express';
import cors from 'cors';
import { env } from './lib/env';
import { healthRouter } from './routes/health';
import { projectsRouter } from './routes/projects';
import { generationsRouter } from './routes/generations';
import { billingRouter } from './routes/billing';
import { notificationsRouter } from './routes/notifications';

const app = express();

app.use(cors({ origin: env.APP_URL, credentials: true }));
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') return next();
  return express.json()(req, res, next);
});

app.use(healthRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/generations', generationsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/notifications', notificationsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  res.status(500).json({ error: message });
});

app.listen(env.API_PORT, () => {
  console.log(`Lumora API listening on http://localhost:${env.API_PORT}`);
});
