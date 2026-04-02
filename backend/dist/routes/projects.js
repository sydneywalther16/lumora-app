"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const projectService_1 = require("../services/projectService");
const createProjectSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    prompt: zod_1.z.string().min(1),
    stylePreset: zod_1.z.string().min(1),
});
exports.projectsRouter = (0, express_1.Router)();
exports.projectsRouter.use(auth_1.requireAuth);
exports.projectsRouter.get('/', async (req, res) => {
    const projects = await (0, projectService_1.listProjectsForUser)(req.userId);
    res.json({ projects });
});
exports.projectsRouter.post('/', async (req, res) => {
    const payload = createProjectSchema.parse(req.body);
    const project = await (0, projectService_1.createProjectForUser)({ userId: req.userId, ...payload });
    res.status(201).json({ project });
});
