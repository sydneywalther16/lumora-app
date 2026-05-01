"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInAppNotification = createInAppNotification;
exports.listNotificationsForUser = listNotificationsForUser;
exports.markNotificationRead = markNotificationRead;
exports.savePushSubscription = savePushSubscription;
const db_1 = require("./db");
async function createInAppNotification(input) {
    await (0, db_1.query)(`insert into notifications (user_id, type, title, body) values ($1, $2, $3, $4)`, [input.userId, input.type, input.title, input.body]);
}
async function listNotificationsForUser(userId) {
    const result = await (0, db_1.query)(`select id, type, title, body, read_at as "readAt", created_at as "createdAt"
     from notifications
     where user_id = $1
     order by created_at desc
     limit 100`, [userId]);
    return result.rows;
}
async function markNotificationRead(userId, notificationId) {
    const result = await (0, db_1.query)(`update notifications
     set read_at = now()
     where user_id = $1 and id = $2
     returning id, type, title, body, read_at as "readAt", created_at as "createdAt"`, [userId, notificationId]);
    return result.rows[0] ?? null;
}
async function savePushSubscription(input) {
    await (0, db_1.query)(`insert into push_subscriptions (user_id, subscription_json)
     values ($1, $2)
     on conflict (user_id) do update set subscription_json = excluded.subscription_json, updated_at = now()`, [input.userId, JSON.stringify(input.subscription)]);
}
