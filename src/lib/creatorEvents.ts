import { supabase } from './supabase';

export type CreatorEventName =
  | 'onboarding_started'
  | 'self_character_created'
  | 'first_storyboard_built'
  | 'first_draft_created'
  | 'draft_published'
  | 'continue_story_clicked'
  | 'character_opened'
  | 'character_deleted'
  | 'for_you_item_opened'
  | 'like_clicked'
  | 'save_clicked'
  | 'follow_clicked'
  | 'generation_failed'
  | 'moderation_adapted'
  | 'asset_persisted';

type CreatorEventProperties = Record<string, string | number | boolean | null | undefined>;

const LOCAL_EVENT_KEY = 'lumora_creator_events_v1';

function scrubProperties(properties: CreatorEventProperties): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value.slice(0, 240) : value ?? null,
      ]),
  ) as Record<string, string | number | boolean | null>;
}

function rememberLocalEvent(event: {
  eventName: CreatorEventName;
  userId?: string | null;
  properties: Record<string, string | number | boolean | null>;
  createdAt: string;
}) {
  if (typeof window === 'undefined') return;

  try {
    const existing = JSON.parse(localStorage.getItem(LOCAL_EVENT_KEY) || '[]') as unknown;
    const events = Array.isArray(existing) ? existing : [];
    localStorage.setItem(LOCAL_EVENT_KEY, JSON.stringify([event, ...events].slice(0, 120)));
  } catch {
    // Ignore local analytics storage failures.
  }
}

export function hasCreatorEvent(eventName: CreatorEventName) {
  if (typeof window === 'undefined') return false;

  try {
    const existing = JSON.parse(localStorage.getItem(LOCAL_EVENT_KEY) || '[]') as unknown;
    return Array.isArray(existing)
      ? existing.some((event) => Boolean(event && typeof event === 'object' && (event as { eventName?: unknown }).eventName === eventName))
      : false;
  } catch {
    return false;
  }
}

export async function trackCreatorEvent(
  eventName: CreatorEventName,
  properties: CreatorEventProperties = {},
  userId?: string | null,
) {
  const safeProperties = scrubProperties(properties);
  const createdAt = new Date().toISOString();
  const event = {
    eventName,
    userId: userId ?? null,
    properties: safeProperties,
    createdAt,
  };

  rememberLocalEvent(event);

  if (!supabase) return;

  try {
    await supabase.from('creator_experience_events').insert({
      user_id: userId ?? null,
      event_name: eventName,
      properties: safeProperties,
      route: typeof window !== 'undefined' ? window.location.pathname : null,
      created_at: createdAt,
    });
  } catch {
    // The table may not be migrated yet. Creator flows should never fail because analytics did.
  }
}
