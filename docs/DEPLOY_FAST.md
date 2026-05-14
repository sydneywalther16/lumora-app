# Lumora Deploy Fast

This repo is already structured for a fast MVP deployment:
- **Supabase** for database, auth, storage
- **Vercel** for the frontend
- **Render** for the API and worker
- **Stripe** for billing

## 1) Create Supabase project
Create a new Supabase project named `lumora`, then run these SQL files in order:
1. `backend/supabase/migrations/20260325_init.sql`
2. `backend/supabase/migrations/20260326_rls_and_buckets.sql`
3. Any later migration files in `backend/supabase/migrations/`, in filename order.

Copy these values from Supabase:
- Project URL
- anon public key
- service role key
- database password / connection string

## Character Profiles v1 rollout
Character Profiles v1 needs the Memory Engine, Scene Executor clip metadata, and Character Profiles schema repair migrations in Supabase.

Fastest PowerShell path from the repo root:

```powershell
.\scripts\copy-migration-to-clipboard.ps1 memory-engine
```

Paste into Supabase SQL Editor and click **Run**.

```powershell
.\scripts\copy-migration-to-clipboard.ps1 scene-executor
```

Paste into Supabase SQL Editor and click **Run**.

```powershell
.\scripts\copy-migration-to-clipboard.ps1 character-profiles
```

Paste into Supabase SQL Editor and click **Run**.

The helper copies only the SQL contents. It does not copy PowerShell prompts or extra instructions.

The Character Profiles repair migration is:
- `backend/supabase/migrations/20260512_character_profiles_schema_repair.sql`

It is idempotent and safe to run again. It creates or repairs:
- `character_profiles`
- `generation_jobs.character_id`
- `generation_jobs.scene_execution_id`
- `generation_jobs.scene_id`
- `generation_jobs.clip_order`
- `generation_jobs.scene_metadata`
- Character profile memory/index/RLS support

## Feed, Drafts, and thumbnails rollout
Apply the social feed and Drafts lifecycle migration after the Character Profiles repair migration:

```powershell
.\scripts\copy-migration-to-clipboard.ps1 feed-drafts
```

Paste into Supabase SQL Editor and click **Run**.

The migration is:
- `backend/supabase/migrations/20260512_feed_drafts_thumbnails.sql`

It is idempotent and safe to run again. It creates or repairs:
- Draft/publish lifecycle columns on `projects`
- Published feed lifecycle columns on `posts`
- `thumbnail_url` / `poster_url` fallbacks
- engagement counters used by For You ranking
- `follows` table for v1 recommendation boosts
- explicit RLS so users can read public posts and their own drafts

## 2) Frontend env vars (Vercel)
Set these on Vercel:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` or `VITE_API_URL` only if the frontend should call a separate API host. Leave both unset to use same-origin Vercel `/api` routes.
- `REPLICATE_API_TOKEN` if using same-origin Vercel `/api` generation routes.

Framework preset: **Vite**
Output directory: `dist`
Install command: `npm install`
Build command: `npm run build`

## 3) Backend env vars (Render)
Set these on Render for both the API service and worker service:
- `NODE_ENV=production`
- `PORT=10000`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `REPLICATE_API_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`
- `APP_BASE_URL`
- `WEB_ORIGIN`
- `DEMO_MODE=false`

Build command:
- `npm install && npm run build`

API start command:
- `npm run start:api`

Worker start command:
- `npm run start:worker`

## 4) Stripe
Create a monthly product/price called `Lumora Pro`, then add the `price_...` value to `STRIPE_PRICE_ID`.
Create a webhook that points to:
- `https://YOUR-RENDER-API.onrender.com/api/billing/webhook`

Listen for:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## 5) Final smoke test
- Sign up in the app
- Create a project
- Submit a generation
- Check `/api/health`
- Complete a Stripe checkout test
- Verify notification appears in inbox

## Production verification
After applying the migrations, redeploy the backend and frontend:

1. Render: redeploy the API service.
2. Render: redeploy the worker service if it is enabled.
3. Vercel: redeploy the frontend.

Then open:

```text
https://YOUR-API-HOST/api/health/diagnostics
```

Expected database success state:
- `database.ok` is `true`
- `character_profiles table exists` is `OK`
- `continuity_memory_states table exists` is `OK`
- `generation_jobs.character_id exists` is `OK`
- `generation_jobs.scene_execution_id exists` is `OK`
- `generation_jobs.scene_id exists` is `OK`
- `generation_jobs.clip_order exists` is `OK`
- `generation_jobs.scene_metadata exists` is `OK`
- `projects.status exists` is `OK`
- `projects.published_at exists` is `OK`
- `projects.thumbnail_url exists` is `OK`
- `posts.status exists` is `OK`
- `posts.published_at exists` is `OK`
- `posts.thumbnail_url exists` is `OK`
- `follows table exists` is `OK`
- service role read/write checks are `OK`
- RLS policies are available

Expected app success state:
- `/capture` saves Character Profiles without schema errors.
- `/create` shows the Character Profile selector and Continuity Memory panel.
- Creative Brain can build a storyboard plan.
- Scene Executor can render storyboard clips without `generation_jobs.character_id` errors.
- `/drafts` shows only unpublished drafts with thumbnails.
- `/studio` redirects to `/drafts`.
- Publishing a draft removes it from Drafts and makes it eligible for Profile, Home, and For You.
- `/for-you` shows the discovery search bar and thumbnail grid.
