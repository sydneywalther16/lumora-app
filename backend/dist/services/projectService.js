"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProjectsForUser = listProjectsForUser;
exports.createProjectForUser = createProjectForUser;
const db_1 = require("./db");
async function listProjectsForUser(userId) {
    const result = await (0, db_1.query)(`select id, title, status, updated_at as "updatedAt", style_preset as "stylePreset"
     from projects
     where user_id = $1
     order by updated_at desc
     limit 50`, [userId]);
    return result.rows;
}
async function createProjectForUser(input) {
    const result = await (0, db_1.query)(`insert into projects (user_id, title, prompt, style_preset, status)
     values ($1, $2, $3, $4, 'draft')
     returning id, title, status, updated_at as "updatedAt", style_preset as "stylePreset"`, [input.userId, input.title, input.prompt, input.stylePreset]);
    return result.rows[0];
}
