# Lumora Full-Stack MVP Plus

This version pushes the starter closer to a real launch build. In addition to the original mobile UI and backend scaffold, it now includes deployment, worker, PWA, richer notification flows, billing sync scaffolding, and Supabase persistence for creator profiles, self characters, fictional characters, projects, drafts, posts, media metadata, RLS, and storage buckets.

## What was added in this pass

### Product / app experience
- PWA manifest and service worker registration
- demo-ready generation queue worker
- generation job listing endpoint
- notification list + mark-as-read endpoints

### Backend / data
- persisted generation jobs in Postgres
- creator app persistence tables for profiles, characters, self_characters, projects, drafts, posts, and media_assets
- billing customer upsert helper for Stripe webhook events
- Supabase RLS migration
- storage bucket migrations for avatars, reference images, self-capture videos, voice samples, generated videos, and post thumbnails
- demo seed script refresh

### Ops / deployment
- Dockerfile
- docker-compose for local services
- Render worker + web service config
- Vercel config for frontend hosting
- GitHub Actions CI build workflow


## New quick-start deployment helpers

- `docs/DEPLOY_FAST.md` – exact deploy order and where each key goes
- `.env.example` - frontend env template for Vercel/local Vite
- `backend/.env.example` – backend-only env template for Render/local API
- `npm run verify:deploy` – checks for required env vars before deploy
- `npm run build:api` – compiles backend TypeScript to `backend/dist`
- `npm run start:api` / `npm run start:worker` – production startup commands

## Main commands

```bash
npm install
cp .env.example .env
npm run dev
npm run dev:api
npm run worker
npm run build
npm run check
```

## Local stack

```bash
docker compose up postgres redis api
```

## Almost-launch checklist

1. Add real Supabase project keys
2. Run all SQL migrations in `backend/supabase/migrations` in Supabase
3. Confirm the six Lumora storage buckets exist if migration permissions require manual setup
4. Add Stripe product + price IDs
5. Point frontend env to deployed API URL
6. Replace the demo generation worker with a true provider queue
7. Add real push delivery with web-push or native mobile notifications
8. Add App Store assets, legal docs, and analytics

## Supabase Setup

1. Go to Supabase dashboard
2. Open SQL Editor
3. Run:
   `backend/supabase/migrations/20260430_creator_app_persistence.sql`
4. Go to Project Settings → API
5. Copy:
   - Project URL
   - anon public key
6. Add to Vercel:
   `VITE_SUPABASE_URL`
   `VITE_SUPABASE_ANON_KEY`
7. Redeploy project

## Honest status

This is now very close to the “99% done” zone for an MVP starter. The big remaining 1% is mostly provider credentials, deployment clicks, app store packaging, and final QA across real environments.
