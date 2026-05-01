# Lumora backend architecture

## Core services
- **Supabase Auth** for email, OAuth, session handling
- **Postgres** for app tables and analytics-ready metadata
- **Supabase Storage** for uploads and rendered assets
- **OpenAI adapter** for image/video generation
- **Stripe** for subscriptions and billing lifecycle
- **Notifications** for in-app alerts, email, and push subscriptions

## Suggested production evolution
1. Move `submitGenerationJob` onto BullMQ workers.
2. Persist provider job IDs in `generation_jobs`.
3. Add signed upload URLs for creator media.
4. Add webhook handlers from your generation provider.
5. Add rate limits and usage accounting by plan.
