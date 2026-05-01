import express from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { env } from './lib/env';
import { healthRouter } from './routes/health';
import { projectsRouter } from './routes/projects';
import { generationsRouter } from './routes/generations';
import { charactersRouter } from './routes/characters';
import { billingRouter } from './routes/billing';
import { notificationsRouter } from './routes/notifications';
import { postsRouter } from './routes/posts';

const app = express();
const LOCAL_ORIGIN_WHITELIST = [
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:4176',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4174',
  'http://127.0.0.1:4175',
  'http://127.0.0.1:4176',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || LOCAL_ORIGIN_WHITELIST.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') return next();
  return express.json({ limit: '35mb' })(req, res, next);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(healthRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/characters', charactersRouter);
app.use('/api/generations', generationsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/notifications', notificationsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request payload.', details: error.issues });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error';
  res.status(500).json({ error: message });
});

const server = app.listen(env.API_PORT, () => {
  console.log(`Lumora API listening on http://localhost:${env.API_PORT}`);
});

server.on('error', (error) => {
  console.error('API server failed to start:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('Lumora API stopped');
    process.exit(0);
  });
});
