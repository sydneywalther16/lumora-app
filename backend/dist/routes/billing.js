"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingRouter = void 0;
const express_1 = require("express");
const express_2 = __importDefault(require("express"));
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const billingService_1 = require("../services/billingService");
const env_1 = require("../lib/env");
const stripe_1 = require("../lib/stripe");
const notificationService_1 = require("../services/notificationService");
const checkoutSchema = zod_1.z.object({ priceId: zod_1.z.string().min(1) });
exports.billingRouter = (0, express_1.Router)();
exports.billingRouter.post('/webhook', express_2.default.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe_1.stripe || !env_1.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(400).send('Stripe is not configured');
    }
    const signature = req.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) {
        return res.status(400).send('Missing stripe signature');
    }
    const event = stripe_1.stripe.webhooks.constructEvent(req.body, signature, env_1.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata?.userId ?? session.client_reference_id;
        if (userId) {
            await (0, billingService_1.upsertBillingCustomer)({
                userId,
                stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
                stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
                status: 'active',
                planSlug: 'pro',
            });
            await (0, notificationService_1.createInAppNotification)({
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
            await (0, billingService_1.upsertBillingCustomer)({
                userId,
                stripeSubscriptionId: subscription.id,
                status: subscription.status,
                planSlug: 'free',
            });
        }
    }
    res.json({ received: true });
});
exports.billingRouter.use(auth_1.requireAuth);
exports.billingRouter.post('/checkout', async (req, res) => {
    const payload = checkoutSchema.parse(req.body);
    const url = await (0, billingService_1.createCheckoutSession)({
        userId: req.userId,
        email: req.userEmail,
        priceId: payload.priceId,
    });
    res.json({ url });
});
