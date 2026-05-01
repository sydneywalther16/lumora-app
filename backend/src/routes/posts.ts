import { Router } from 'express';
import { z } from 'zod';
import { env } from '../lib/env';
import { createPost, listPosts } from '../services/postService';

const createPostSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  sourceGenerationId: z.string().uuid().optional().nullable(),
});

export const postsRouter = Router();

postsRouter.get('/', async (_req, res) => {
  if (!env.DATABASE_URL) {
    return res.json({ posts: [] });
  }

  const posts = await listPosts();
  res.json({ posts });
});

postsRouter.post('/', async (req, res) => {
  if (!env.DATABASE_URL) {
    return res.status(503).json({
      error: 'Database is not configured. Set DATABASE_URL to use this service.',
    });
  }

  const payload = createPostSchema.parse(req.body);
  const post = await createPost(payload);
  res.status(201).json({ post });
});
