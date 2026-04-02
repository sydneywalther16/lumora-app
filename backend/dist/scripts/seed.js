"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const db_1 = require("../services/db");
async function seed() {
    const userId = (0, node_crypto_1.randomUUID)();
    await (0, db_1.query)(`insert into profiles (id, handle, display_name, bio, plan_slug)
     values ($1, 'lumora_demo', 'Lumora Demo', 'Demo creator profile', 'free')
     on conflict do nothing`, [userId]);
    await (0, db_1.query)(`insert into projects (user_id, title, prompt, style_preset, status)
     values ($1, 'Golden Hour Street Shoot', 'Cinematic influencer street portrait at sunset', 'editorial', 'draft')`, [userId]);
    await (0, db_1.query)(`insert into notifications (user_id, type, title, body)
     values ($1, 'system', 'Welcome to Lumora', 'Your starter data has been created.')`, [userId]);
    console.log('Seed complete for demo user:', userId);
}
seed()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
