import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { createCheckoutSession, upsertBillingCustomer } from '../services/billingService';
import { env } from '../lib/env';
import { stripe } from '../lib/stripe';
import { createInAppNotification } from '../services/notificationService';

const checkoutSchema = z.object({ priceId: z.string().min(1) });

export const billingRouter = Router();

billingRouter.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send('Stripe is not configured');
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || Array.isArray(signature)) {
    return res.status(400).send('Missing stripe signature');
  }

  const event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId ?? session.client_reference_id;
    if (userId) {
      await upsertBillingCustomer({
        userId,
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
        stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
        status: 'active',
        planSlug: 'pro',
      });

      await createInAppNotification({
        userId,
        type: 'billing',
        title: 'Subscription activated',
        body: 'Your Lumora Pro plan is now active.',
      });
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.userId;
    if (userId) {
      await upsertBillingCustomer({
        userId,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        planSlug: 'free',
      });
    }
  }

  res.json({ received: true });
});

billingRouter.use(requireAuth);

billingRouter.post('/checkout', async (req: AuthedRequest, res) => {
  const payload = checkoutSchema.parse(req.body);
  const url = await createCheckoutSession({
    userId: req.userId!,
    email: req.userEmail,
    priceId: payload.priceId,
  });

  res.json({ url });
});
