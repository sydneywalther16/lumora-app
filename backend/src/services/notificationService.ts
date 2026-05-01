import { query } from './db';

export type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export async function createInAppNotification(input: {
  userId: string;
  type: string;
  title: string;
  body: string;
}) {
  await query(
    `insert into notifications (user_id, type, title, body) values ($1, $2, $3, $4)`,
    [input.userId, input.type, input.title, input.body],
  );
}

export async function listNotificationsForUser(userId: string) {
  const result = await query<NotificationRecord>(
    `select id, type, title, body, read_at as "readAt", created_at as "createdAt"
     from notifications
     where user_id = $1
     order by created_at desc
     limit 100`,
    [userId],
  );

  return result.rows;
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const result = await query<NotificationRecord>(
    `update notifications
     set read_at = now()
     where user_id = $1 and id = $2
     returning id, type, title, body, read_at as "readAt", created_at as "createdAt"`,
    [userId, notificationId],
  );

  return result.rows[0] ?? null;
}

export async function savePushSubscription(input: { userId: string; subscription: unknown }) {
  await query(
    `insert into push_subscriptions (user_id, subscription_json)
     values ($1, $2)
     on conflict (user_id) do update set subscription_json = excluded.subscription_json, updated_at = now()`,
    [input.userId, JSON.stringify(input.subscription)],
  );
}
