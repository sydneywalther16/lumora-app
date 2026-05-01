import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { createProjectForUser, listProjectsForUser } from '../services/projectService';

const createProjectSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  stylePreset: z.string().min(1),
});

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

projectsRouter.get('/', async (req: AuthedRequest, res) => {
  const projects = await listProjectsForUser(req.userId!);
  res.json({ projects });
});

projectsRouter.post('/', async (req: AuthedRequest, res) => {
  const payload = createProjectSchema.parse(req.body);
  const project = await createProjectForUser({
    userId: req.userId!,
    title: payload.title,
    prompt: payload.prompt,
    stylePreset: payload.stylePreset,
  });
  res.status(201).json({ project });
});
