"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generationsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const aiService_1 = require("../services/aiService");
const projectService_1 = require("../services/projectService");
const notificationService_1 = require("../services/notificationService");
const generationService_1 = require("../services/generationService");
const generationSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    prompt: zod_1.z.string().min(1),
    stylePreset: zod_1.z.string().min(1),
    outputType: zod_1.z.enum(['image', 'video']),
});
exports.generationsRouter = (0, express_1.Router)();
exports.generationsRouter.use(auth_1.requireAuth);
exports.generationsRouter.get('/', async (req, res) => {
    const jobs = await (0, generationService_1.listGenerationJobsForUser)(req.userId);
    res.json({ jobs });
});
exports.generationsRouter.post('/', async (req, res) => {
    const payload = generationSchema.parse(req.body);
    const project = await (0, projectService_1.createProjectForUser)({
        userId: req.userId,
        title: payload.title,
        prompt: payload.prompt,
        stylePreset: payload.stylePreset,
    });
    const job = await (0, aiService_1.submitGenerationJob)({
        userId: req.userId,
        projectId: project.id,
        title: payload.title,
        prompt: payload.prompt,
        stylePreset: payload.stylePreset,
        outputType: payload.outputType,
    });
    await (0, notificationService_1.createInAppNotification)({
        userId: req.userId,
        type: 'generation',
        title: 'Generation queued',
        body: `${payload.title} is now ${job.status}.`,
    });
    res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        provider: job.provider,
        project,
    });
});
