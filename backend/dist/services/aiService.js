"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitGenerationJob = submitGenerationJob;
exports.completeGenerationJobDemo = completeGenerationJobDemo;
const node_crypto_1 = require("node:crypto");
const openaiClient_1 = require("../lib/openaiClient");
const env_1 = require("../lib/env");
const generationService_1 = require("./generationService");
async function submitGenerationJob(input) {
    const provider = input.outputType === 'video' ? env_1.env.OPENAI_VIDEO_MODEL : env_1.env.OPENAI_IMAGE_MODEL;
    const providerJobId = (0, node_crypto_1.randomUUID)();
    const demoMode = !openaiClient_1.openai;
    const job = await (0, generationService_1.createGenerationJob)({
        userId: input.userId,
        projectId: input.projectId,
        provider: demoMode ? 'demo' : provider,
        providerJobId,
        outputType: input.outputType,
        prompt: input.prompt,
        status: demoMode ? 'queued-demo' : 'queued',
    });
    return {
        jobId: job.id,
        status: job.status,
        provider: job.provider,
        providerJobId,
        message: demoMode ? 'Queued in demo mode. Start the worker to auto-complete placeholders.' : 'Queued with provider adapter.',
    };
}
async function completeGenerationJobDemo(jobId) {
    return (0, generationService_1.updateGenerationJobStatus)({
        jobId,
        status: 'completed',
        resultAssetUrl: `${env_1.env.APP_URL}/demo-assets/${jobId}.jpg`,
    });
}
