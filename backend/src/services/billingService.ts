import { stripe } from '../lib/stripe';
import { env } from '../lib/env';
import { query } from './db';

export async function createCheckoutSession(input: { userId: string; email?: string; priceId: string }) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${env.APP_URL}/profile?billing=success`,
    cancel_url: `${env.APP_URL}/profile?billing=cancelled`,
    customer_email: input.email,
    client_reference_id: input.userId,
    metadata: { userId: input.userId },
  });

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  return session.url;
}

export async function upsertBillingCustomer(input: {
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status?: string | null;
  planSlug?: string | null;
  currentPeriodEnd?: string | null;
}) {
  await query(
    `insert into billing_customers (
       user_id, stripe_customer_id, stripe_subscription_id, status, plan_slug, current_period_end
     )
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id) do update set
       stripe_customer_id = coalesce(excluded.stripe_customer_id, billing_customers.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id, billing_customers.stripe_subscription_id),
       status = coalesce(excluded.status, billing_customers.status),
       plan_slug = coalesce(excluded.plan_slug, billing_customers.plan_slug),
       current_period_end = coalesce(excluded.current_period_end, billing_customers.current_period_end),
       updated_at = now()`,
    [
      input.userId,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.status ?? null,
      input.planSlug ?? null,
      input.currentPeriodEnd ?? null,
    ],
  );

  await query(`update profiles set plan_slug = coalesce($2, plan_slug), updated_at = now() where user_id = $1`, [input.userId, input.planSlug ?? null]);
}
