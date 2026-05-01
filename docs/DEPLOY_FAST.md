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

Copy these values from Supabase:
- Project URL
- anon public key
- service role key
- database password / connection string

## 2) Frontend env vars (Vercel)
Set these on Vercel:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`

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
