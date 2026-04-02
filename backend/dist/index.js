"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const env_1 = require("./lib/env");
const health_1 = require("./routes/health");
const projects_1 = require("./routes/projects");
const generations_1 = require("./routes/generations");
const billing_1 = require("./routes/billing");
const notifications_1 = require("./routes/notifications");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: env_1.env.APP_URL, credentials: true }));
app.use('/api/billing/webhook', express_1.default.raw({ type: 'application/json' }));
app.use((req, res, next) => {
    if (req.originalUrl === '/api/billing/webhook')
        return next();
    return express_1.default.json()(req, res, next);
});
app.use(health_1.healthRouter);
app.use('/api/projects', projects_1.projectsRouter);
app.use('/api/generations', generations_1.generationsRouter);
app.use('/api/billing', billing_1.billingRouter);
app.use('/api/notifications', notifications_1.notificationsRouter);
app.use((error, _req, res, _next) => {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    res.status(500).json({ error: message });
});
app.listen(env_1.env.API_PORT, () => {
    console.log(`Lumora API listening on http://localhost:${env_1.env.API_PORT}`);
});
