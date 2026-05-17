import express from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { env } from './lib/env';
import { corsOptionsDelegate, logCorsConfiguration } from './lib/corsConfig';
import { logEnvironmentDiagnostics } from './lib/envDiagnostics';
import { healthRouter } from './routes/health';
import { projectsRouter } from './routes/projects';
import { creativeBrainRouter } from './routes/creativeBrain';
import { generationsRouter } from './routes/generations';
import { charactersRouter } from './routes/characters';
import { billingRouter } from './routes/billing';
import { notificationsRouter } from './routes/notifications';
import { postsRouter } from './routes/posts';
import { providersRouter } from './routes/providers';

const app = express();
app.use(cors(corsOptionsDelegate));
app.options(/.*/, (_req, res) => {
  res.sendStatus(204);
});
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  if (req.path === '/api/billing/webhook') return next();
  return express.json({ limit: '35mb' })(req, res, next);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(healthRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/characters', charactersRouter);
app.use('/api/creative-brain', creativeBrainRouter);
app.use('/api/generations', generationsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/providers', providersRouter);

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
  logCorsConfiguration();
  logEnvironmentDiagnostics();
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
