import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { submitGenerationJob } from '../services/aiService';
import { createProjectForUser } from '../services/projectService';
import { createInAppNotification } from '../services/notificationService';
import { listGenerationJobsForUser } from '../services/generationService';

const generationSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  stylePreset: z.string().min(1),
  outputType: z.enum(['image', 'video']),
});

export const generationsRouter = Router();
generationsRouter.use(requireAuth);

generationsRouter.get('/', async (req: AuthedRequest, res) => {
  const jobs = await listGenerationJobsForUser(req.userId!);
  res.json({ jobs });
});

generationsRouter.post('/', async (req: AuthedRequest, res) => {
  const payload = generationSchema.parse(req.body);
  const project = await createProjectForUser({
    userId: req.userId!,
    title: payload.title,
    prompt: payload.prompt,
    stylePreset: payload.stylePreset,
  });

  const job = await submitGenerationJob({
    userId: req.userId!,
    projectId: project.id,
    title: payload.title,
    prompt: payload.prompt,
    stylePreset: payload.stylePreset,
    outputType: payload.outputType,
  });

  await createInAppNotification({
    userId: req.userId!,
    type: 'generation',
    title: 'Generation queued',
    body: `${payload.title} is now ${job.status}.`,
  });

  res.status(202).json({
    jobId: job.jobId,
    status: job.status,
    provider: job.provider,
    project,
  });
});
