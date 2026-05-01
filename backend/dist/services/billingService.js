"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCheckoutSession = createCheckoutSession;
exports.upsertBillingCustomer = upsertBillingCustomer;
const stripe_1 = require("../lib/stripe");
const env_1 = require("../lib/env");
const db_1 = require("./db");
async function createCheckoutSession(input) {
    if (!stripe_1.stripe) {
        throw new Error('Stripe is not configured');
    }
    const session = await stripe_1.stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: `${env_1.env.APP_URL}/profile?billing=success`,
        cancel_url: `${env_1.env.APP_URL}/profile?billing=cancelled`,
        customer_email: input.email,
        client_reference_id: input.userId,
        metadata: { userId: input.userId },
    });
    if (!session.url) {
        throw new Error('Stripe did not return a checkout URL');
    }
    return session.url;
}
async function upsertBillingCustomer(input) {
    await (0, db_1.query)(`insert into billing_customers (
       user_id, stripe_customer_id, stripe_subscription_id, status, plan_slug, current_period_end
     )
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id) do update set
       stripe_customer_id = coalesce(excluded.stripe_customer_id, billing_customers.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id, billing_customers.stripe_subscription_id),
       status = coalesce(excluded.status, billing_customers.status),
       plan_slug = coalesce(excluded.plan_slug, billing_customers.plan_slug),
       current_period_end = coalesce(excluded.current_period_end, billing_customers.current_period_end),
       updated_at = now()`, [
        input.userId,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        input.status ?? null,
        input.planSlug ?? null,
        input.currentPeriodEnd ?? null,
    ]);
    await (0, db_1.query)(`update profiles set plan_slug = coalesce($2, plan_slug), updated_at = now() where id = $1`, [input.userId, input.planSlug ?? null]);
}
