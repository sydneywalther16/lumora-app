"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aiService_1 = require("../services/aiService");
const generationService_1 = require("../services/generationService");
const POLL_MS = Number(process.env.GENERATION_WORKER_POLL_MS ?? 4000);
async function tick() {
    const job = await (0, generationService_1.claimQueuedGenerationJob)();
    if (!job)
        return;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await (0, aiService_1.completeGenerationJobDemo)(job.id);
}
async function loop() {
    console.log('Lumora generation worker started');
    while (true) {
        try {
            await tick();
        }
        catch (error) {
            console.error('Worker tick failed', error);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}
loop().catch((error) => {
    console.error(error);
    process.exit(1);
});
