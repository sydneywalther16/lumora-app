"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGenerationJob = createGenerationJob;
exports.listGenerationJobsForUser = listGenerationJobsForUser;
exports.updateGenerationJobStatus = updateGenerationJobStatus;
exports.claimQueuedGenerationJob = claimQueuedGenerationJob;
const db_1 = require("./db");
async function createGenerationJob(input) {
    const result = await (0, db_1.query)(`insert into generation_jobs (user_id, project_id, provider, provider_job_id, output_type, prompt, status)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning
       id,
       project_id as "projectId",
       status,
       output_type as "outputType",
       provider,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       created_at as "createdAt",
       updated_at as "updatedAt"`, [input.userId, input.projectId, input.provider, input.providerJobId ?? null, input.outputType, input.prompt, input.status]);
    return result.rows[0];
}
async function listGenerationJobsForUser(userId) {
    const result = await (0, db_1.query)(`select
       id,
       project_id as "projectId",
       status,
       output_type as "outputType",
       provider,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       created_at as "createdAt",
       updated_at as "updatedAt"
     from generation_jobs
     where user_id = $1
     order by created_at desc
     limit 50`, [userId]);
    return result.rows;
}
async function updateGenerationJobStatus(input) {
    const result = await (0, db_1.query)(`update generation_jobs
     set
       status = $2,
       result_asset_url = coalesce($3, result_asset_url),
       error_message = $4,
       updated_at = now()
     where id = $1
     returning
       id,
       project_id as "projectId",
       status,
       output_type as "outputType",
       provider,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       created_at as "createdAt",
       updated_at as "updatedAt"`, [input.jobId, input.status, input.resultAssetUrl ?? null, input.errorMessage ?? null]);
    return result.rows[0] ?? null;
}
async function claimQueuedGenerationJob() {
    const result = await (0, db_1.query)(`update generation_jobs
     set status = 'processing', updated_at = now()
     where id = (
       select id from generation_jobs
       where status in ('queued', 'queued-demo')
       order by created_at asc
       for update skip locked
       limit 1
     )
     returning
       id,
       project_id as "projectId",
       status,
       output_type as "outputType",
       provider,
       result_asset_url as "resultAssetUrl",
       error_message as "errorMessage",
       created_at as "createdAt",
       updated_at as "updatedAt"`);
    return result.rows[0] ?? null;
}
