"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const notificationService_1 = require("../services/notificationService");
const subscriptionSchema = zod_1.z.object({
    subscription: zod_1.z.unknown(),
});
const markReadSchema = zod_1.z.object({
    notificationId: zod_1.z.string().uuid(),
});
exports.notificationsRouter = (0, express_1.Router)();
exports.notificationsRouter.use(auth_1.requireAuth);
exports.notificationsRouter.get('/', async (req, res) => {
    const notifications = await (0, notificationService_1.listNotificationsForUser)(req.userId);
    res.json({ notifications });
});
exports.notificationsRouter.post('/read', async (req, res) => {
    const payload = markReadSchema.parse(req.body);
    const notification = await (0, notificationService_1.markNotificationRead)(req.userId, payload.notificationId);
    res.json({ notification });
});
exports.notificationsRouter.post('/push/subscribe', async (req, res) => {
    const payload = subscriptionSchema.parse(req.body);
    await (0, notificationService_1.savePushSubscription)({ userId: req.userId, subscription: payload.subscription });
    res.json({ success: true });
});
